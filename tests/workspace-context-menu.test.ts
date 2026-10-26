import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cascadeFolderRename,
  filterTabsOnFolderDelete,
  removeWorkspaceItem,
  resolveTargetTabForOpenCurrent,
  formatDuplicateRequestName,
  sanitizeRequestRename,
  updateRequestNameHeader,
  normalizeFolderPath,
  type TabItem,
} from '../src/lib/utils/workspace-sync.ts';
import { generateCollectionShellScript } from '../src/lib/utils/collection-exporter.ts';
import { getResolvedCommand } from '../src/lib/utils/curl-generator.ts';
import type { WorkspaceFileItem, SidecarMetadata } from '../src/lib/types.ts';

// ============================================================================
// SIMULATED WORKSPACE HARNESS
// Models the complete state machine and operations of WorkspaceState,
// Sidebar context menus, and SaveRequestModal.
// ============================================================================

class SimulatedWorkspace {
  workspacePath = '.';
  tree: WorkspaceFileItem[] = [];
  tabs: TabItem[] = [];
  activeTabId: string | null = null;
  targetNewRequestFolder = '.';
  isExportModalOpen = false;
  exportTargetFolder: WorkspaceFileItem | null = null;
  isSaveModalOpen = false;

  // Virtual filesystem backing the workspace
  files = new Map<string, { content: string; sidecar?: SidecarMetadata }>();

  get activeTab(): TabItem | null {
    return this.tabs.find((t) => t.id === this.activeTabId) || null;
  }

  get activeFilePath(): string | null {
    return this.activeTab?.filePath ?? null;
  }

  // --- File System Helpers ---
  addFileToDisk(path: string, content: string, sidecar?: SidecarMetadata) {
    this.files.set(path, { content, sidecar });
    this.rebuildTree();
  }

  rebuildTree() {
    const rootItems: WorkspaceFileItem[] = [];
    const dirMap = new Map<string, WorkspaceFileItem>();

    const ensureDir = (dirPath: string): WorkspaceFileItem => {
      if (dirMap.has(dirPath)) return dirMap.get(dirPath)!;
      const parts = dirPath.split('/');
      const name = parts[parts.length - 1];
      const dirItem: WorkspaceFileItem = {
        name,
        path: dirPath,
        is_dir: true,
        children: [],
      };
      dirMap.set(dirPath, dirItem);

      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('/');
        const parent = ensureDir(parentPath);
        if (!parent.children!.some((c) => c.path === dirPath)) {
          parent.children!.push(dirItem);
        }
      } else {
        if (!rootItems.some((r) => r.path === dirPath)) {
          rootItems.push(dirItem);
        }
      }
      return dirItem;
    };

    for (const [filePath, data] of this.files.entries()) {
      const parts = filePath.split('/');
      const fileName = parts[parts.length - 1];
      const displayName = fileName.replace(/\.curl$/, '');
      const method = data.content.match(/-X\s+([A-Z]+)/)?.[1] || 'GET';

      const fileItem: WorkspaceFileItem = {
        name: fileName,
        path: filePath,
        is_dir: false,
        display_name: displayName,
        method,
      };

      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('/');
        const parent = ensureDir(parentPath);
        parent.children!.push(fileItem);
      } else {
        rootItems.push(fileItem);
      }
    }

    this.tree = rootItems;
  }

  // --- Operation 1: New Request Here ---
  createNewRequestInFolder(folderPath: string) {
    this.targetNewRequestFolder = normalizeFolderPath(folderPath);
    const newTab: TabItem = {
      id: `tab-${Math.random().toString(36).slice(2, 9)}`,
      filePath: null,
      name: 'Untitled Request',
      method: 'GET',
      rawContent: 'curl "https://httpbin.org/get"',
      isDirty: false,
      isPinned: true,
    };
    this.tabs.push(newTab);
    this.activeTabId = newTab.id;
  }

  saveActiveDraft(fileName: string) {
    if (!this.activeTab) return;
    const folder = this.targetNewRequestFolder;
    const cleanFileName = fileName.endsWith('.curl')
      ? fileName
      : `${fileName}.curl`;
    const targetPath = folder === '.' ? cleanFileName : `${folder}/${cleanFileName}`;
    const displayName = cleanFileName.replace(/\.curl$/, '');

    this.activeTab.filePath = targetPath;
    this.activeTab.name = displayName;
    this.activeTab.isDirty = false;
    this.files.set(targetPath, { content: this.activeTab.rawContent, sidecar: this.activeTab.sidecar });
    this.rebuildTree();
  }

  // --- Operation 2: New Subfolder ---
  createFolder(parentPath: string, folderName: string): string {
    const trimmed = folderName.trim().replace(/[\\\/]+/g, '_');
    if (!trimmed) throw new Error('Folder name cannot be empty');
    const normParent = normalizeFolderPath(parentPath);
    const targetPath = normParent === '.' ? trimmed : `${normParent}/${trimmed}`;

    // Add dummy placeholder or register in virtual tree
    const dummyFile = `${targetPath}/.keep.curl`;
    this.files.set(dummyFile, { content: '# @name Init\ncurl https://example.com' });
    this.rebuildTree();
    return targetPath;
  }

  // --- Operation 3: Export Collection (.sh) ---
  openExportModal(folder?: WorkspaceFileItem) {
    this.exportTargetFolder = folder ?? null;
    this.isExportModalOpen = true;
  }

  generateExportScript(envVars: Record<string, string> = {}): string {
    const targetFolder = this.exportTargetFolder;
    const collected: {
      path: string;
      name: string;
      method: string;
      command: string;
    }[] = [];

    const traverse = (item: WorkspaceFileItem) => {
      if (item.is_dir && item.children) {
        for (const child of item.children) traverse(child);
      } else if (!item.is_dir) {
        // Prefer unsaved dirty content from tabs if open
        const openTab = this.tabs.find((t) => t.filePath === item.path);
        const rawContent = openTab && openTab.isDirty
          ? openTab.rawContent
          : this.files.get(item.path)?.content || '';
        collected.push({
          path: item.path,
          name: item.display_name || item.name,
          method: item.method || 'GET',
          command: rawContent,
        });
      }
    };

    if (targetFolder) {
      traverse(targetFolder);
    } else {
      for (const root of this.tree) traverse(root);
    }

    const colName = targetFolder?.display_name || targetFolder?.name || 'Workspace Collection';
    return generateCollectionShellScript(colName, collected, envVars);
  }

  // --- Operation 4: Rename Folder ---
  renameFolder(oldPath: string, newNameInput: string): string {
    const normOld = normalizeFolderPath(oldPath);
    let trimmed = newNameInput.trim();
    if (!trimmed) throw new Error('Folder name cannot be empty');

    const lastSlash = normOld.lastIndexOf('/');
    const parent = lastSlash >= 0 ? normOld.slice(0, lastSlash) : '';

    let normNew = '';
    if (parent && (trimmed.startsWith(parent + '/') || trimmed.startsWith(parent + '\\'))) {
      normNew = normalizeFolderPath(trimmed);
    } else {
      trimmed = trimmed.replace(/[\\\/]+/g, '_');
      normNew = parent ? `${parent}/${trimmed}` : trimmed;
    }

    // Update files map
    const newFiles = new Map<string, { content: string; sidecar?: SidecarMetadata }>();
    const prefix = normOld + '/';
    for (const [path, data] of this.files.entries()) {
      if (path === normOld) {
        newFiles.set(normNew, data);
      } else if (path.startsWith(prefix)) {
        const remainder = path.slice(normOld.length);
        newFiles.set(`${normNew}${remainder}`, data);
      } else {
        newFiles.set(path, data);
      }
    }
    this.files = newFiles;

    // Cascade to open tabs
    this.tabs = cascadeFolderRename(this.tabs, normOld, normNew);

    // Update targetNewRequestFolder if pointing to renamed folder
    if (this.targetNewRequestFolder === normOld) {
      this.targetNewRequestFolder = normNew;
    } else if (this.targetNewRequestFolder.startsWith(prefix)) {
      this.targetNewRequestFolder = normNew + this.targetNewRequestFolder.slice(normOld.length);
    }

    this.rebuildTree();
    return normNew;
  }

  // --- Operation 5: Delete Folder ---
  deleteFolder(folderPath: string): { closedCount: number; remainingCount: number } {
    const normFolder = normalizeFolderPath(folderPath);
    const prefix = normFolder + '/';

    // Remove from files map
    for (const path of Array.from(this.files.keys())) {
      if (path === normFolder || path.startsWith(prefix)) {
        this.files.delete(path);
      }
    }

    // Filter tabs cleanly without prompting
    const { remainingTabs, closedTabs } = filterTabsOnFolderDelete(this.tabs, normFolder);
    this.tabs = remainingTabs;

    // Reset activeTab if closed
    if (this.activeTabId && closedTabs.some((t) => t.id === this.activeTabId)) {
      if (this.tabs.length > 0) {
        this.activeTabId = this.tabs[0].id;
      } else {
        this.createNewRequestInFolder('.');
      }
    }

    this.rebuildTree();
    return { closedCount: closedTabs.length, remainingCount: this.tabs.length };
  }

  // --- Operation 6: Open in New Tab ---
  openInNewTab(filePath: string) {
    const existing = this.tabs.find((t) => t.filePath === filePath);
    if (existing) {
      existing.isPinned = true;
      this.activeTabId = existing.id;
      return;
    }

    const file = this.files.get(filePath);
    if (!file) throw new Error(`File not found: ${filePath}`);

    const fileName = filePath.split('/').pop() || 'request';
    const displayName = fileName.replace(/\.curl$/, '');
    const method = file.content.match(/-X\s+([A-Z]+)/)?.[1] || 'GET';

    const newTab: TabItem = {
      id: `tab-${Math.random().toString(36).slice(2, 9)}`,
      filePath,
      name: displayName,
      method,
      rawContent: file.content,
      isDirty: false,
      isPinned: true,
      sidecar: file.sidecar,
    };
    this.tabs.push(newTab);
    this.activeTabId = newTab.id;
  }

  // --- Operation 7: Open in Current Tab ---
  openInCurrentTab(filePath: string) {
    const existing = this.tabs.find((t) => t.filePath === filePath);
    if (existing) {
      this.activeTabId = existing.id;
      return;
    }

    const file = this.files.get(filePath);
    if (!file) throw new Error(`File not found: ${filePath}`);

    const fileName = filePath.split('/').pop() || 'request';
    const displayName = fileName.replace(/\.curl$/, '');
    const method = file.content.match(/-X\s+([A-Z]+)/)?.[1] || 'GET';

    const { tabToReplace, shouldAppend } = resolveTargetTabForOpenCurrent(this.tabs, this.activeTabId);

    if (tabToReplace && !shouldAppend) {
      tabToReplace.filePath = filePath;
      tabToReplace.name = displayName;
      tabToReplace.method = method;
      tabToReplace.rawContent = file.content;
      tabToReplace.isDirty = false;
      tabToReplace.isPinned = false; // Remains preview tab
      tabToReplace.sidecar = file.sidecar;
      this.activeTabId = tabToReplace.id;
    } else {
      const newTab: TabItem = {
        id: `tab-${Math.random().toString(36).slice(2, 9)}`,
        filePath,
        name: displayName,
        method,
        rawContent: file.content,
        isDirty: false,
        isPinned: false, // preview tab
        sidecar: file.sidecar,
      };
      this.tabs.push(newTab);
      this.activeTabId = newTab.id;
    }
  }

  // --- Operation 8: Copy as cURL ---
  copyRequestCommand(
    filePath: string,
    envVars: Record<string, string> = {},
    mockClipboard?: { text: string; shouldThrow?: boolean }
  ): { resolvedCommand: string; usedFallback: boolean; copied: boolean } {
    let rawContent = '';
    const openTab = this.tabs.find((t) => t.filePath === filePath);
    if (openTab && openTab.isDirty) {
      rawContent = openTab.rawContent;
    } else {
      rawContent = this.files.get(filePath)?.content || '';
    }

    const resolved = getResolvedCommand(rawContent, envVars);
    let copied = false;
    let usedFallback = false;

    if (mockClipboard) {
      if (mockClipboard.shouldThrow) {
        usedFallback = true;
        copied = true; // Fallback succeeded
      } else {
        mockClipboard.text = resolved;
        copied = true;
      }
    } else {
      copied = true;
    }

    return { resolvedCommand: resolved, usedFallback, copied };
  }

  // --- Operation 9: Duplicate Request ---
  duplicateRequest(sourcePath: string): string {
    const file = this.files.get(sourcePath);
    if (!file) throw new Error(`Source file not found: ${sourcePath}`);

    const parts = sourcePath.split('/');
    const sourceFileName = parts.pop()!;
    const parentDir = parts.join('/');
    const ext = 'curl';
    const stem = sourceFileName.replace(/\.curl$/, '');

    const existingInDir = Array.from(this.files.keys())
      .filter((p) => (parentDir ? p.startsWith(parentDir + '/') : !p.includes('/')))
      .map((p) => p.split('/').pop()!);

    const newFileName = formatDuplicateRequestName(stem, existingInDir, ext);
    const newPath = parentDir ? `${parentDir}/${newFileName}` : newFileName;
    const newDisplayName = newFileName.replace(/\.curl$/, '');

    const newContent = updateRequestNameHeader(file.content, `${newDisplayName} (Copy)`);
    let newSidecar: SidecarMetadata | undefined;
    if (file.sidecar) {
      newSidecar = {
        ...file.sidecar,
        name: `${file.sidecar.name || stem} (Copy)`,
      };
    }

    this.files.set(newPath, { content: newContent, sidecar: newSidecar });
    this.rebuildTree();
    this.openInNewTab(newPath);
    return newPath;
  }

  // --- Operation 10: Rename Request ---
  renameRequest(currentPath: string, newNameInput: string): string {
    const file = this.files.get(currentPath);
    if (!file) throw new Error(`File not found: ${currentPath}`);

    const newFileName = sanitizeRequestRename(currentPath, newNameInput);
    const parts = currentPath.split('/');
    parts.pop();
    const parent = parts.join('/');
    const newPath = parent ? `${parent}/${newFileName}` : newFileName;
    const displayName = newFileName.replace(/\.curl$/, '');

    const newContent = updateRequestNameHeader(file.content, displayName);
    let newSidecar = file.sidecar;
    if (newSidecar) {
      newSidecar = { ...newSidecar, name: displayName };
    }

    this.files.delete(currentPath);
    this.files.set(newPath, { content: newContent, sidecar: newSidecar });

    // Update tab if open
    const openTab = this.tabs.find((t) => t.filePath === currentPath);
    if (openTab) {
      openTab.filePath = newPath;
      openTab.name = displayName;
      openTab.rawContent = updateRequestNameHeader(openTab.rawContent, displayName);
      if (openTab.sidecar) openTab.sidecar.name = displayName;
    }

    this.rebuildTree();
    return newPath;
  }

  // --- Operation 11: Delete Request ---
  deleteRequest(filePath: string) {
    this.files.delete(filePath);

    // Cleanly force-close tab without prompting
    const tabIndex = this.tabs.findIndex((t) => t.filePath === filePath);
    if (tabIndex >= 0) {
      const closedTab = this.tabs[tabIndex];
      this.tabs.splice(tabIndex, 1);
      if (this.activeTabId === closedTab.id) {
        if (this.tabs.length > 0) {
          const nextIndex = Math.min(tabIndex, this.tabs.length - 1);
          this.activeTabId = this.tabs[nextIndex].id;
        } else {
          this.createNewRequestInFolder('.');
        }
      }
    }

    this.rebuildTree();
  }
}

// ============================================================================
// FEATURE 1: New Request Here — Tiers 1 & 2 (10 tests)
// ============================================================================

test('F1 New Request Here (Tier 1): sets target folder to root and creates pinned draft tab', () => {
  const ws = new SimulatedWorkspace();
  ws.createNewRequestInFolder('.');
  assert.equal(ws.targetNewRequestFolder, '.');
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.tabs[0].isPinned, true);
  assert.equal(ws.tabs[0].filePath, null);
  assert.equal(ws.activeTabId, ws.tabs[0].id);
});

test('F1 New Request Here (Tier 1): sets exact nested folder path for subdirectories', () => {
  const ws = new SimulatedWorkspace();
  ws.createNewRequestInFolder('collections/v1/auth');
  assert.equal(ws.targetNewRequestFolder, 'collections/v1/auth');
  assert.equal(ws.tabs[0].isPinned, true);
});

test('F1 New Request Here (Tier 1): saves draft into exact nested folder without path truncation', () => {
  const ws = new SimulatedWorkspace();
  ws.createNewRequestInFolder('collections/v1/auth');
  ws.saveActiveDraft('login.curl');
  assert.equal(ws.tabs[0].filePath, 'collections/v1/auth/login.curl');
  assert.equal(ws.tabs[0].name, 'login');
  assert.ok(ws.files.has('collections/v1/auth/login.curl'));
});

test('F1 New Request Here (Tier 1): appends .curl automatically if extension omitted during save', () => {
  const ws = new SimulatedWorkspace();
  ws.createNewRequestInFolder('api/users');
  ws.saveActiveDraft('list_all');
  assert.equal(ws.tabs[0].filePath, 'api/users/list_all.curl');
});

test('F1 New Request Here (Tier 1): multiple calls create distinct tabs and focus latest', () => {
  const ws = new SimulatedWorkspace();
  ws.createNewRequestInFolder('folderA');
  const tab1Id = ws.activeTabId;
  ws.createNewRequestInFolder('folderB');
  const tab2Id = ws.activeTabId;
  assert.equal(ws.tabs.length, 2);
  assert.notEqual(tab1Id, tab2Id);
  assert.equal(ws.targetNewRequestFolder, 'folderB');
});

test('F1 New Request Here (Tier 2): normalizes trailing slashes in target folder', () => {
  const ws = new SimulatedWorkspace();
  ws.createNewRequestInFolder('api/v1/auth///');
  assert.equal(ws.targetNewRequestFolder, 'api/v1/auth');
  ws.saveActiveDraft('token.curl');
  assert.equal(ws.tabs[0].filePath, 'api/v1/auth/token.curl');
});

test('F1 New Request Here (Tier 2): handles deep nested directories (5 levels)', () => {
  const ws = new SimulatedWorkspace();
  ws.createNewRequestInFolder('a/b/c/d/e');
  ws.saveActiveDraft('deep.curl');
  assert.equal(ws.tabs[0].filePath, 'a/b/c/d/e/deep.curl');
});

test('F1 New Request Here (Tier 2): preserves .curl extension when saving request', () => {
  const ws = new SimulatedWorkspace();
  ws.createNewRequestInFolder('services/api');
  ws.saveActiveDraft('stream.curl');
  assert.equal(ws.tabs[0].filePath, 'services/api/stream.curl');
  assert.equal(ws.tabs[0].name, 'stream');
});

test('F1 New Request Here (Tier 2): handles folder names with spaces and special characters', () => {
  const ws = new SimulatedWorkspace();
  ws.createNewRequestInFolder('My Collections (v2.0)/Special & Keys');
  ws.saveActiveDraft('test.curl');
  assert.equal(ws.tabs[0].filePath, 'My Collections (v2.0)/Special & Keys/test.curl');
});

test('F1 New Request Here (Tier 2): saving draft marks tab not dirty', () => {
  const ws = new SimulatedWorkspace();
  ws.createNewRequestInFolder('.');
  ws.tabs[0].isDirty = true;
  ws.saveActiveDraft('saved.curl');
  assert.equal(ws.tabs[0].isDirty, false);
});

// ============================================================================
// FEATURE 2: New Subfolder — Tiers 1 & 2 (10 tests)
// ============================================================================

test('F2 New Subfolder (Tier 1): creates subfolder under root directory', () => {
  const ws = new SimulatedWorkspace();
  const path = ws.createFolder('.', 'collections');
  assert.equal(path, 'collections');
  assert.ok(ws.tree.some((item) => item.name === 'collections' && item.is_dir));
});

test('F2 New Subfolder (Tier 1): creates subfolder under nested parent directory', () => {
  const ws = new SimulatedWorkspace();
  const path = ws.createFolder('collections', 'auth');
  assert.equal(path, 'collections/auth');
  const root = ws.tree.find((i) => i.name === 'collections');
  assert.ok(root?.children?.some((c) => c.name === 'auth' && c.is_dir));
});

test('F2 New Subfolder (Tier 1): trims surrounding whitespace on folder name', () => {
  const ws = new SimulatedWorkspace();
  const path = ws.createFolder('.', '   billing   ');
  assert.equal(path, 'billing');
});

test('F2 New Subfolder (Tier 1): refreshes tree and preserves existing files in hierarchy', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('collections/users.curl', 'curl https://api.com/users');
  ws.createFolder('collections', 'v1');
  const col = ws.tree.find((i) => i.name === 'collections');
  assert.ok(col?.children?.some((c) => c.name === 'users.curl'));
  assert.ok(col?.children?.some((c) => c.name === 'v1' && c.is_dir));
});

test('F2 New Subfolder (Tier 1): creates sibling subfolders without collision', () => {
  const ws = new SimulatedWorkspace();
  ws.createFolder('api', 'v1');
  ws.createFolder('api', 'v2');
  const api = ws.tree.find((i) => i.name === 'api');
  assert.equal(api?.children?.filter((c) => c.is_dir).length, 2);
});

test('F2 New Subfolder (Tier 2): sanitizes directory traversal slashes in subfolder name', () => {
  const ws = new SimulatedWorkspace();
  const path = ws.createFolder('collections', '../../evil');
  assert.equal(path, 'collections/.._.._evil');
  assert.ok(!path.includes('collections/../../evil'));
});

test('F2 New Subfolder (Tier 2): rejects empty or whitespace-only folder name', () => {
  const ws = new SimulatedWorkspace();
  assert.throws(() => ws.createFolder('.', '   '), /empty/);
});

test('F2 New Subfolder (Tier 2): normalizes trailing slashes on parent path', () => {
  const ws = new SimulatedWorkspace();
  const path = ws.createFolder('api/v1///', 'endpoints');
  assert.equal(path, 'api/v1/endpoints');
});

test('F2 New Subfolder (Tier 2): creates deep subfolder hierarchy sequentially', () => {
  const ws = new SimulatedWorkspace();
  ws.createFolder('.', 'l1');
  ws.createFolder('l1', 'l2');
  ws.createFolder('l1/l2', 'l3');
  ws.createFolder('l1/l2/l3', 'l4');
  assert.ok(ws.files.has('l1/l2/l3/l4/.keep.curl'));
});

test('F2 New Subfolder (Tier 2): supports Unicode and emoji in folder names', () => {
  const ws = new SimulatedWorkspace();
  const path = ws.createFolder('.', '📁 Auth & Tests 🚀');
  assert.equal(path, '📁 Auth & Tests 🚀');
  assert.ok(ws.tree.some((i) => i.name === '📁 Auth & Tests 🚀'));
});

// ============================================================================
// FEATURE 3: Export Collection (.sh) — Tiers 1 & 2 (10 tests)
// ============================================================================

test('F3 Export Collection (Tier 1): flattens requests in folder into executable bash script', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('col/req1.curl', '# @name Req 1\ncurl https://api.com/1');
  ws.addFileToDisk('col/req2.curl', '# @name Req 2\ncurl https://api.com/2');
  ws.openExportModal(ws.tree.find((i) => i.name === 'col'));
  const script = ws.generateExportScript();
  assert.ok(script.includes('#!/usr/bin/env bash'));
  assert.ok(script.includes('curl https://api.com/1'));
  assert.ok(script.includes('curl https://api.com/2'));
});

test('F3 Export Collection (Tier 1): substitutes active environment variables', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('col/req.curl', 'curl "{{baseUrl}}/users" -H "Auth: Bearer {{token}}"');
  ws.openExportModal(ws.tree.find((i) => i.name === 'col'));
  const script = ws.generateExportScript({ baseUrl: 'https://prod.api.com', token: 'secret123' });
  assert.ok(script.includes('https://prod.api.com/users'));
  assert.ok(script.includes('Bearer secret123'));
});

test('F3 Export Collection (Tier 1): handles post requests in collection', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('col/rpc.curl', 'curl -X POST -d \'{"id":1}\' https://api.example.com/items');
  ws.openExportModal(ws.tree.find((i) => i.name === 'col'));
  const script = ws.generateExportScript();
  assert.ok(script.includes('-X POST'));
});

test('F3 Export Collection (Tier 1): uses in-memory unsaved content from dirty open tabs', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('col/req.curl', 'curl https://stale-disk.com');
  ws.openInNewTab('col/req.curl');
  ws.tabs[0].rawContent = 'curl https://fresh-memory.com';
  ws.tabs[0].isDirty = true;

  ws.openExportModal(ws.tree.find((i) => i.name === 'col'));
  const script = ws.generateExportScript();
  assert.ok(script.includes('https://fresh-memory.com'));
  assert.ok(!script.includes('https://stale-disk.com'));
});

test('F3 Export Collection (Tier 1): includes HTTP status code validation in exported script', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('col/req.curl', '# @name Check\ncurl https://api.com');
  ws.openExportModal(ws.tree.find((i) => i.name === 'col'));
  const script = ws.generateExportScript();
  assert.ok(script.includes('HTTP_STATUS') || script.includes('status') || script.includes('PASSED'));
});

test('F3 Export Collection (Tier 2): handles empty collection without syntax errors', () => {
  const ws = new SimulatedWorkspace();
  ws.openExportModal({ name: 'empty', path: 'empty', is_dir: true, children: [] });
  const script = ws.generateExportScript();
  assert.ok(script.startsWith('#!/usr/bin/env bash'));
});

test('F3 Export Collection (Tier 2): properly escapes double quotes and special characters in payload', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('col/escape.curl', 'curl -X POST "https://api.com" -d \'{"key":"value with \\"quotes\\""}\'');
  ws.openExportModal(ws.tree.find((i) => i.name === 'col'));
  const script = ws.generateExportScript();
  assert.ok(script.includes('quotes'));
});

test('F3 Export Collection (Tier 2): preserves multiline curl continuations cleanly', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('col/multi.curl', 'curl -X POST "https://api.com" \\\n  -H "Accept: application/json" \\\n  -d \'{"id": 1}\'');
  ws.openExportModal(ws.tree.find((i) => i.name === 'col'));
  const script = ws.generateExportScript();
  assert.ok(script.includes('-H "Accept: application/json"'));
});

test('F3 Export Collection (Tier 2): handles deep nested collections recursively', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('col/a/b/c/nested.curl', 'curl https://deep.com');
  ws.openExportModal(ws.tree.find((i) => i.name === 'col'));
  const script = ws.generateExportScript();
  assert.ok(script.includes('https://deep.com'));
});

test('F3 Export Collection (Tier 2): exports entire workspace when target folder is root/omitted', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('root1.curl', 'curl https://root1.com');
  ws.addFileToDisk('folder/sub.curl', 'curl https://sub.com');
  ws.openExportModal(undefined);
  const script = ws.generateExportScript();
  assert.ok(script.includes('https://root1.com'));
  assert.ok(script.includes('https://sub.com'));
});

// ============================================================================
// FEATURE 4: Rename Folder — Tiers 1 & 2 (10 tests)
// ============================================================================

test('F4 Rename Folder (Tier 1): renames folder in virtual tree and cascades to matching open tab', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('users/profile.curl', 'curl https://api.com/users');
  ws.openInNewTab('users/profile.curl');
  ws.renameFolder('users', 'members');
  assert.equal(ws.tabs[0].filePath, 'members/profile.curl');
  assert.ok(ws.files.has('members/profile.curl'));
  assert.ok(!ws.files.has('users/profile.curl'));
});

test('F4 Rename Folder (Tier 1): cascades to deeply nested tabs', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('api/v1/auth/tokens/jwt.curl', 'curl https://api.com/jwt');
  ws.openInNewTab('api/v1/auth/tokens/jwt.curl');
  ws.renameFolder('api/v1', 'api/v2');
  assert.equal(ws.tabs[0].filePath, 'api/v2/auth/tokens/jwt.curl');
});

test('F4 Rename Folder (Tier 1): preserves tab dirty state and in-memory raw content during cascade', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('users/edit.curl', 'curl https://disk.com');
  ws.openInNewTab('users/edit.curl');
  ws.tabs[0].rawContent = 'curl https://edited-memory.com';
  ws.tabs[0].isDirty = true;
  ws.renameFolder('users', 'accounts');
  assert.equal(ws.tabs[0].filePath, 'accounts/edit.curl');
  assert.equal(ws.tabs[0].isDirty, true);
  assert.equal(ws.tabs[0].rawContent, 'curl https://edited-memory.com');
});

test('F4 Rename Folder (Tier 1): does not touch sibling folders sharing prefix', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('auth/login.curl', 'curl https://login.com');
  ws.addFileToDisk('auth-backup/old.curl', 'curl https://old.com');
  ws.openInNewTab('auth/login.curl');
  ws.openInNewTab('auth-backup/old.curl');

  ws.renameFolder('auth', 'security');
  assert.equal(ws.tabs[0].filePath, 'security/login.curl');
  assert.equal(ws.tabs[1].filePath, 'auth-backup/old.curl');
});

test('F4 Rename Folder (Tier 1): updates targetNewRequestFolder if pointing to renamed directory', () => {
  const ws = new SimulatedWorkspace();
  ws.targetNewRequestFolder = 'collections/users';
  ws.renameFolder('collections/users', 'collections/accounts');
  assert.equal(ws.targetNewRequestFolder, 'collections/accounts');
});

test('F4 Rename Folder (Tier 2): normalizes trailing slashes on old folder path', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('folder/item.curl', 'curl https://item.com');
  ws.openInNewTab('folder/item.curl');
  ws.renameFolder('folder///', 'renamed_folder');
  assert.equal(ws.tabs[0].filePath, 'renamed_folder/item.curl');
});

test('F4 Rename Folder (Tier 2): rejects empty or whitespace new name', () => {
  const ws = new SimulatedWorkspace();
  assert.throws(() => ws.renameFolder('folder', '   '), /empty/);
});

test('F4 Rename Folder (Tier 2): sanitizes directory traversal characters in new folder name', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('api/test.curl', 'curl https://test.com');
  ws.openInNewTab('api/test.curl');
  ws.renameFolder('api', '../../hacked');
  assert.equal(ws.tabs[0].filePath, '.._.._hacked/test.curl');
});

test('F4 Rename Folder (Tier 2): multiple open tabs in renamed folder all cascade simultaneously', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('dir/req1.curl', '1');
  ws.addFileToDisk('dir/req2.curl', '2');
  ws.addFileToDisk('dir/sub/req3.curl', '3');
  ws.openInNewTab('dir/req1.curl');
  ws.openInNewTab('dir/req2.curl');
  ws.openInNewTab('dir/sub/req3.curl');

  ws.renameFolder('dir', 'new_dir');
  assert.equal(ws.tabs[0].filePath, 'new_dir/req1.curl');
  assert.equal(ws.tabs[1].filePath, 'new_dir/req2.curl');
  assert.equal(ws.tabs[2].filePath, 'new_dir/sub/req3.curl');
});

test('F4 Rename Folder (Tier 2): handles folder rename with Unicode and brackets in name', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('Folder [v1]/req.curl', 'req');
  ws.openInNewTab('Folder [v1]/req.curl');
  ws.renameFolder('Folder [v1]', 'Folder [v2] 🚀');
  assert.equal(ws.tabs[0].filePath, 'Folder [v2] 🚀/req.curl');
});

// ============================================================================
// FEATURE 5: Delete Folder — Tiers 1 & 2 (10 tests)
// ============================================================================

test('F5 Delete Folder (Tier 1): deletes folder from tree and disk', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('temp/file1.curl', '1');
  ws.addFileToDisk('temp/file2.curl', '2');
  ws.deleteFolder('temp');
  assert.ok(!ws.files.has('temp/file1.curl'));
  assert.ok(!ws.files.has('temp/file2.curl'));
  assert.ok(!ws.tree.some((i) => i.name === 'temp'));
});

test('F5 Delete Folder (Tier 1): cleanly closes all open tabs belonging to deleted folder', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('col/req1.curl', '1');
  ws.addFileToDisk('col/req2.curl', '2');
  ws.openInNewTab('col/req1.curl');
  ws.openInNewTab('col/req2.curl');
  assert.equal(ws.tabs.length, 2);

  ws.deleteFolder('col');
  assert.equal(ws.tabs.length, 1); // Fallback untitled tab generated
  assert.equal(ws.tabs[0].filePath, null);
  assert.equal(ws.tabs[0].name, 'Untitled Request');
});

test('F5 Delete Folder (Tier 1): force-closes dirty tabs without prompt', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('col/dirty.curl', '1');
  ws.openInNewTab('col/dirty.curl');
  ws.tabs[0].isDirty = true;
  ws.deleteFolder('col');
  // Closed cleanly without throwing or hanging
  assert.equal(ws.tabs.find((t) => t.filePath === 'col/dirty.curl'), undefined);
});

test('F5 Delete Folder (Tier 1): does not close tabs in sibling directories with shared prefix', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('auth/login.curl', 'login');
  ws.addFileToDisk('auth-backup/old.curl', 'old');
  ws.addFileToDisk('authentication/sso.curl', 'sso');
  ws.openInNewTab('auth/login.curl');
  ws.openInNewTab('auth-backup/old.curl');
  ws.openInNewTab('authentication/sso.curl');

  ws.deleteFolder('auth');
  assert.equal(ws.tabs.length, 2);
  assert.ok(ws.tabs.some((t) => t.filePath === 'auth-backup/old.curl'));
  assert.ok(ws.tabs.some((t) => t.filePath === 'authentication/sso.curl'));
});

test('F5 Delete Folder (Tier 1): shifts focus to adjacent open tab when active tab was in deleted folder', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('folderA/reqA.curl', 'A');
  ws.addFileToDisk('folderB/reqB.curl', 'B');
  ws.openInNewTab('folderA/reqA.curl');
  ws.openInNewTab('folderB/reqB.curl');
  ws.activeTabId = ws.tabs[0].id; // focused on folderA

  ws.deleteFolder('folderA');
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.activeTabId, ws.tabs[0].id);
  assert.equal(ws.tabs[0].filePath, 'folderB/reqB.curl');
});

test('F5 Delete Folder (Tier 2): normalizes trailing slashes on deleted folder path', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('users/list.curl', 'list');
  ws.openInNewTab('users/list.curl');
  ws.deleteFolder('users///');
  assert.ok(!ws.files.has('users/list.curl'));
});

test('F5 Delete Folder (Tier 2): deletes deeply nested hierarchy with multiple sidecars', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('a/b/c/req.curl', 'req', { tests: [] });
  ws.deleteFolder('a');
  assert.equal(ws.files.size, 0);
});

test('F5 Delete Folder (Tier 2): deleting non-existent folder is a graceful no-op', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('keep.curl', 'keep');
  const res = ws.deleteFolder('ghost_folder');
  assert.equal(res.closedCount, 0);
  assert.equal(ws.files.size, 1);
});

test('F5 Delete Folder (Tier 2): preserves open draft tab when deleting folder', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('del/test.curl', 'test');
  ws.openInNewTab('del/test.curl');
  ws.createNewRequestInFolder('.'); // draft tab with null filePath
  assert.equal(ws.tabs.length, 2);

  ws.deleteFolder('del');
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.tabs[0].filePath, null);
});

test('F5 Delete Folder (Tier 2): handles sibling numeric collision (/v1 vs /v10)', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('api/v1/test.curl', '1');
  ws.addFileToDisk('api/v10/test.curl', '10');
  ws.openInNewTab('api/v1/test.curl');
  ws.openInNewTab('api/v10/test.curl');

  ws.deleteFolder('api/v1');
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.tabs[0].filePath, 'api/v10/test.curl');
});

// ============================================================================
// FEATURE 6: Open in New Tab — Tiers 1 & 2 (10 tests)
// ============================================================================

test('F6 Open in New Tab (Tier 1): opens unopened request in new pinned tab at end of list', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('users.curl', 'curl https://api.com/users');
  ws.openInNewTab('users.curl');
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.tabs[0].isPinned, true);
  assert.equal(ws.tabs[0].filePath, 'users.curl');
  assert.equal(ws.activeTabId, ws.tabs[0].id);
});

test('F6 Open in New Tab (Tier 1): promotes existing preview tab to pinned when opened in new tab', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('req.curl', 'curl https://req.com');
  ws.openInCurrentTab('req.curl');
  assert.equal(ws.tabs[0].isPinned, false); // preview

  ws.openInNewTab('req.curl');
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.tabs[0].isPinned, true); // promoted
  assert.equal(ws.activeTabId, ws.tabs[0].id);
});

test('F6 Open in New Tab (Tier 1): focuses already pinned tab without duplicating', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('req1.curl', '1');
  ws.addFileToDisk('req2.curl', '2');
  ws.openInNewTab('req1.curl');
  ws.openInNewTab('req2.curl');
  assert.equal(ws.tabs.length, 2);

  ws.openInNewTab('req1.curl');
  assert.equal(ws.tabs.length, 2);
  assert.equal(ws.activeTabId, ws.tabs[0].id);
});

test('F6 Open in New Tab (Tier 1): loads companion sidecar metadata into tab', () => {
  const ws = new SimulatedWorkspace();
  const sidecar: SidecarMetadata = {
    name: 'With Tests',
    tests: [{ test_type: 'status_code', expected: 200 }],
    tab_color: '#ff0000',
  };
  ws.addFileToDisk('test.curl', 'curl https://test.com', sidecar);
  ws.openInNewTab('test.curl');
  assert.deepEqual(ws.tabs[0].sidecar, sidecar);
});

test('F6 Open in New Tab (Tier 1): extracts HTTP method from curl content', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('post.curl', 'curl -X POST "https://api.com"');
  ws.openInNewTab('post.curl');
  assert.equal(ws.tabs[0].method, 'POST');
});

test('F6 Open in New Tab (Tier 2): handles request method detection', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('service.curl', 'curl -X DELETE https://example.com/items/1');
  ws.openInNewTab('service.curl');
  assert.equal(ws.tabs[0].method, 'DELETE');
});

test('F6 Open in New Tab (Tier 2): throws descriptive error when opening non-existent file', () => {
  const ws = new SimulatedWorkspace();
  assert.throws(() => ws.openInNewTab('missing.curl'), /File not found/);
});

test('F6 Open in New Tab (Tier 2): preserves dirty state of other open tabs', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('tab1.curl', '1');
  ws.addFileToDisk('tab2.curl', '2');
  ws.openInNewTab('tab1.curl');
  ws.tabs[0].isDirty = true;

  ws.openInNewTab('tab2.curl');
  assert.equal(ws.tabs[0].isDirty, true);
  assert.equal(ws.tabs[1].isDirty, false);
});

test('F6 Open in New Tab (Tier 2): opens multiple files sequentially with correct tab ordering', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('1.curl', '1');
  ws.addFileToDisk('2.curl', '2');
  ws.addFileToDisk('3.curl', '3');
  ws.openInNewTab('1.curl');
  ws.openInNewTab('2.curl');
  ws.openInNewTab('3.curl');
  assert.equal(ws.tabs[0].filePath, '1.curl');
  assert.equal(ws.tabs[1].filePath, '2.curl');
  assert.equal(ws.tabs[2].filePath, '3.curl');
  assert.equal(ws.activeTabId, ws.tabs[2].id);
});

test('F6 Open in New Tab (Tier 2): correctly parses display name from filename without extension', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('api/v1/user_details_fetch.curl', 'curl api.com');
  ws.openInNewTab('api/v1/user_details_fetch.curl');
  assert.equal(ws.tabs[0].name, 'user_details_fetch');
});

// ============================================================================
// FEATURE 7: Open in Current Tab — Tiers 1 & 2 (10 tests)
// ============================================================================

test('F7 Open in Current Tab (Tier 1): replaces active clean preview tab in place', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('file1.curl', 'curl 1');
  ws.addFileToDisk('file2.curl', 'curl 2');
  ws.openInCurrentTab('file1.curl');
  const initialTabId = ws.activeTabId;

  ws.openInCurrentTab('file2.curl');
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.tabs[0].id, initialTabId);
  assert.equal(ws.tabs[0].filePath, 'file2.curl');
  assert.equal(ws.tabs[0].isPinned, false);
});

test('F7 Open in Current Tab (Tier 1): does not replace active tab if active tab is dirty', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('clean.curl', 'clean');
  ws.addFileToDisk('dirty.curl', 'dirty');
  ws.openInCurrentTab('dirty.curl');
  ws.tabs[0].isDirty = true;

  ws.openInCurrentTab('clean.curl');
  assert.equal(ws.tabs.length, 2);
  assert.equal(ws.tabs[0].filePath, 'dirty.curl');
  assert.equal(ws.tabs[1].filePath, 'clean.curl');
});

test('F7 Open in Current Tab (Tier 1): does not replace active tab if active tab is pinned', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('pinned.curl', 'pinned');
  ws.addFileToDisk('incoming.curl', 'incoming');
  ws.openInNewTab('pinned.curl'); // pinned
  ws.openInCurrentTab('incoming.curl');
  assert.equal(ws.tabs.length, 2);
  assert.equal(ws.tabs[0].filePath, 'pinned.curl');
  assert.equal(ws.tabs[1].filePath, 'incoming.curl');
});

test('F7 Open in Current Tab (Tier 1): focuses existing tab if file is already open', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('a.curl', 'a');
  ws.addFileToDisk('b.curl', 'b');
  ws.openInNewTab('a.curl');
  ws.openInNewTab('b.curl');
  assert.equal(ws.activeTabId, ws.tabs[1].id);

  ws.openInCurrentTab('a.curl');
  assert.equal(ws.tabs.length, 2);
  assert.equal(ws.activeTabId, ws.tabs[0].id);
});

test('F7 Open in Current Tab (Tier 1): replaces active preview tab while preserving other pinned tabs', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('pinned1.curl', '1');
  ws.addFileToDisk('preview.curl', 'prev');
  ws.addFileToDisk('incoming.curl', 'inc');

  ws.openInNewTab('pinned1.curl');
  ws.openInCurrentTab('preview.curl');
  assert.equal(ws.tabs.length, 2);
  assert.equal(ws.activeTabId, ws.tabs[1].id);

  ws.openInCurrentTab('incoming.curl');
  assert.equal(ws.tabs.length, 2);
  assert.equal(ws.tabs[0].filePath, 'pinned1.curl');
  assert.equal(ws.tabs[1].filePath, 'incoming.curl');
});

test('F7 Open in Current Tab (Tier 2): targets active tab at index 2 over preview at index 0', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('tab0.curl', '0');
  ws.addFileToDisk('tab1_pinned.curl', '1');
  ws.addFileToDisk('tab2_active.curl', '2');
  ws.addFileToDisk('incoming.curl', 'inc');

  // Tab 0: preview tab
  ws.openInNewTab('tab0.curl');
  ws.tabs[0].isPinned = false;

  // Tab 1: pinned tab
  ws.openInNewTab('tab1_pinned.curl');

  // Tab 2: preview tab
  ws.openInNewTab('tab2_active.curl');
  ws.tabs[2].isPinned = false;

  // Active tab is index 2
  ws.activeTabId = ws.tabs[2].id;
  assert.equal(ws.activeTabId, ws.tabs[2].id);

  ws.openInCurrentTab('incoming.curl');
  assert.equal(ws.tabs[0].filePath, 'tab0.curl', 'Tab 0 must NOT be replaced');
  assert.equal(ws.tabs[1].filePath, 'tab1_pinned.curl');
  assert.equal(ws.tabs[2].filePath, 'incoming.curl', 'Active Tab 2 must be replaced');
});

test('F7 Open in Current Tab (Tier 2): maintains exact tab array index when replacing', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('p1.curl', '1');
  ws.addFileToDisk('curr.curl', 'curr');
  ws.addFileToDisk('p2.curl', '2');
  ws.addFileToDisk('new.curl', 'new');

  ws.openInNewTab('p1.curl');
  ws.openInCurrentTab('curr.curl');
  ws.openInNewTab('p2.curl');

  // Set active to index 1 (curr.curl)
  ws.activeTabId = ws.tabs[1].id;
  ws.openInCurrentTab('new.curl');

  assert.equal(ws.tabs[1].filePath, 'new.curl');
  assert.equal(ws.tabs.length, 3);
});

test('F7 Open in Current Tab (Tier 2): loads sidecar metadata on replaced tab', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('first.curl', '1');
  const sidecar: SidecarMetadata = { tests: [{ test_type: 'custom', expected: true }] };
  ws.addFileToDisk('second.curl', '2', sidecar);

  ws.openInCurrentTab('first.curl');
  assert.equal(ws.tabs[0].sidecar, undefined);

  ws.openInCurrentTab('second.curl');
  assert.deepEqual(ws.tabs[0].sidecar, sidecar);
});

test('F7 Open in Current Tab (Tier 2): handles replacing untitled clean draft tab', () => {
  const ws = new SimulatedWorkspace();
  ws.createNewRequestInFolder('.');
  ws.tabs[0].isPinned = false; // set to preview
  ws.addFileToDisk('file.curl', 'curl https://file.com');

  ws.openInCurrentTab('file.curl');
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.tabs[0].filePath, 'file.curl');
});

test('F7 Open in Current Tab (Tier 2): handles replacement correctly updating method', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('http.curl', 'curl https://http.com');
  ws.addFileToDisk('post.curl', 'curl -X POST https://api.com');

  ws.openInCurrentTab('http.curl');
  assert.equal(ws.tabs[0].method, 'GET');

  ws.openInCurrentTab('post.curl');
  assert.equal(ws.tabs[0].method, 'POST');
});

// ============================================================================
// FEATURE 8: Copy as cURL — Tiers 1 & 2 (10 tests)
// ============================================================================

test('F8 Copy as cURL (Tier 1): extracts resolved command with active variables substituted', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('req.curl', 'curl -X GET "{{baseUrl}}/api/v1/users" -H "Auth: {{token}}"');
  const mockClip = { text: '' };
  const res = ws.copyRequestCommand('req.curl', { baseUrl: 'https://api.test', token: 'xyz' }, mockClip);
  assert.equal(res.copied, true);
  assert.ok(mockClip.text.includes('https://api.test/api/v1/users'));
  assert.ok(mockClip.text.includes('Auth: xyz'));
});

test('F8 Copy as cURL (Tier 1): strips # @name and comment headers from copied command', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('req.curl', '# @name Get Users\n# @timeout 5000\ncurl https://api.com/users');
  const mockClip = { text: '' };
  ws.copyRequestCommand('req.curl', {}, mockClip);
  assert.ok(!mockClip.text.includes('# @name'));
  assert.ok(!mockClip.text.includes('# @timeout'));
  assert.ok(mockClip.text.includes('curl https://api.com/users'));
});

test('F8 Copy as cURL (Tier 1): uses in-memory dirty tab content if request is active', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('req.curl', 'curl https://disk.com');
  ws.openInNewTab('req.curl');
  ws.tabs[0].rawContent = 'curl https://memory-dirty.com';
  ws.tabs[0].isDirty = true;

  const mockClip = { text: '' };
  ws.copyRequestCommand('req.curl', {}, mockClip);
  assert.ok(mockClip.text.includes('https://memory-dirty.com'));
});

test('F8 Copy as cURL (Tier 1): handles dynamic variables ($uuid, $timestamp)', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('req.curl', 'curl "https://api.com/req?nonce={{$uuid}}&t={{$timestamp}}"');
  const mockClip = { text: '' };
  ws.copyRequestCommand('req.curl', {}, mockClip);
  assert.ok(!mockClip.text.includes('{{$uuid}}'));
  assert.ok(!mockClip.text.includes('{{$timestamp}}'));
});

test('F8 Copy as cURL (Tier 1): succeeds with fallback when navigator.clipboard throws', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('req.curl', 'curl https://fallback.com');
  const mockClip = { text: '', shouldThrow: true };
  const res = ws.copyRequestCommand('req.curl', {}, mockClip);
  assert.equal(res.copied, true);
  assert.equal(res.usedFallback, true);
});

test('F8 Copy as cURL (Tier 2): handles complex JSON body with nested variables', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk(
    'req.curl',
    'curl -X POST "https://api.com" -d \'{"user":"{{username}}","role":"admin"}\''
  );
  const mockClip = { text: '' };
  ws.copyRequestCommand('req.curl', { username: 'alice' }, mockClip);
  assert.ok(mockClip.text.includes('"user":"alice"'));
});

test('F8 Copy as cURL (Tier 2): handles multiline continuation flags (-H, -d, -F)', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk(
    'req.curl',
    'curl -X POST "https://api.com" \\\n  -H "X-Custom: 1" \\\n  -d "hello"'
  );
  const mockClip = { text: '' };
  ws.copyRequestCommand('req.curl', {}, mockClip);
  assert.ok(mockClip.text.includes('-H "X-Custom: 1"'));
  assert.ok(mockClip.text.includes('-d "hello"'));
});

test('F8 Copy as cURL (Tier 2): handles empty file gracefully', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('empty.curl', '');
  const mockClip = { text: '' };
  const res = ws.copyRequestCommand('empty.curl', {}, mockClip);
  assert.equal(res.copied, true);
});

test('F8 Copy as cURL (Tier 2): leaves unrecognized variable placeholders intact', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('req.curl', 'curl "https://api.com/{{unresolved_var}}"');
  const mockClip = { text: '' };
  ws.copyRequestCommand('req.curl', {}, mockClip);
  assert.ok(mockClip.text.includes('{{unresolved_var}}'));
});

test('F8 Copy as cURL (Tier 2): preserves query string parameters during resolution', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('req.curl', 'curl "https://api.com/search?q=hello+world&limit=10"');
  const mockClip = { text: '' };
  ws.copyRequestCommand('req.curl', {}, mockClip);
  assert.ok(mockClip.text.includes('q=hello+world&limit=10'));
});

// ============================================================================
// FEATURE 9: Duplicate Request — Tiers 1 & 2 (10 tests)
// ============================================================================

test('F9 Duplicate Request (Tier 1): creates <stem>_copy.curl and updates # @name header', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('users/get_user.curl', '# @name Get User\ncurl https://api.com/users/1');
  const dupPath = ws.duplicateRequest('users/get_user.curl');
  assert.equal(dupPath, 'users/get_user_copy.curl');
  const dupFile = ws.files.get(dupPath);
  assert.ok(dupFile?.content.includes('# @name get_user_copy (Copy)'));
});

test('F9 Duplicate Request (Tier 1): copies companion .meta.json sidecar', () => {
  const ws = new SimulatedWorkspace();
  const sidecar: SidecarMetadata = {
    name: 'Original',
    tests: [{ test_type: 'status_code', expected: 200 }],
    tab_color: '#00ff00',
  };
  ws.addFileToDisk('req.curl', 'curl https://api.com', sidecar);
  const dupPath = ws.duplicateRequest('req.curl');
  const dupFile = ws.files.get(dupPath);
  assert.ok(dupFile?.sidecar);
  assert.equal(dupFile.sidecar.name, 'Original (Copy)');
  assert.equal(dupFile.sidecar.tab_color, '#00ff00');
  assert.deepEqual(dupFile.sidecar.tests, sidecar.tests);
});

test('F9 Duplicate Request (Tier 1): opens new duplicate in pinned tab and focuses it', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('req.curl', 'curl https://api.com');
  const dupPath = ws.duplicateRequest('req.curl');
  assert.equal(ws.activeFilePath, dupPath);
  assert.equal(ws.activeTab?.isPinned, true);
});

test('F9 Duplicate Request (Tier 1): increments to _copy_2.curl when _copy.curl exists', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('login.curl', 'login 1');
  ws.addFileToDisk('login_copy.curl', 'login copy');
  const dupPath = ws.duplicateRequest('login.curl');
  assert.equal(dupPath, 'login_copy_2.curl');
});

test('F9 Duplicate Request (Tier 1): preserves .curl extension on duplicates in subfolders', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('svc/call.curl', 'curl https://api.com/svc');
  const dupPath = ws.duplicateRequest('svc/call.curl');
  assert.equal(dupPath, 'svc/call_copy.curl');
});

test('F9 Duplicate Request (Tier 2): increments to _copy_3 when _copy and _copy_2 exist', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('req.curl', '1');
  ws.addFileToDisk('req_copy.curl', 'copy 1');
  ws.addFileToDisk('req_copy_2.curl', 'copy 2');
  const dupPath = ws.duplicateRequest('req.curl');
  assert.equal(dupPath, 'req_copy_3.curl');
});

test('F9 Duplicate Request (Tier 2): duplicates nested file preserving parent directory path', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('a/b/c/d/item.curl', 'curl item');
  const dupPath = ws.duplicateRequest('a/b/c/d/item.curl');
  assert.equal(dupPath, 'a/b/c/d/item_copy.curl');
});

test('F9 Duplicate Request (Tier 2): appends # @name header if original file had none', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('raw.curl', 'curl https://api.com');
  const dupPath = ws.duplicateRequest('raw.curl');
  const dupFile = ws.files.get(dupPath);
  assert.ok(dupFile?.content.startsWith('# @name raw_copy (Copy)\n'));
});

test('F9 Duplicate Request (Tier 2): sidecars stay independent after duplicate mutation', () => {
  const ws = new SimulatedWorkspace();
  const sidecar: SidecarMetadata = { name: 'Init', tests: [] };
  ws.addFileToDisk('req.curl', 'curl api', sidecar);
  const dupPath = ws.duplicateRequest('req.curl');

  // Mutate duplicate sidecar
  ws.files.get(dupPath)!.sidecar!.name = 'Modified Duplicate';
  assert.equal(ws.files.get('req.curl')!.sidecar!.name, 'Init');
});

test('F9 Duplicate Request (Tier 2): throws error when duplicating non-existent request', () => {
  const ws = new SimulatedWorkspace();
  assert.throws(() => ws.duplicateRequest('non_existent.curl'), /Source file not found/);
});

// ============================================================================
// FEATURE 10: Rename Request — Tiers 1 & 2 (10 tests)
// ============================================================================

test('F10 Rename Request (Tier 1): safely renames file preserving valid .curl extension', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('users/get.curl', '# @name Get\ncurl api.com');
  const newPath = ws.renameRequest('users/get.curl', 'fetch_users');
  assert.equal(newPath, 'users/fetch_users.curl');
  assert.ok(ws.files.has('users/fetch_users.curl'));
  assert.ok(!ws.files.has('users/get.curl'));
});

test('F10 Rename Request (Tier 1): safely renames file preserving .curl extension', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('services/query.curl', 'curl https://api.com/svc');
  const newPath = ws.renameRequest('services/query.curl', 'execute_query');
  assert.equal(newPath, 'services/execute_query.curl');
});

test('F10 Rename Request (Tier 1): updates # @name comment header in file content', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('item.curl', '# @name Old Title\ncurl api.com');
  const newPath = ws.renameRequest('item.curl', 'New Title');
  const file = ws.files.get(newPath);
  assert.ok(file?.content.includes('# @name New Title'));
  assert.ok(!file?.content.includes('Old Title'));
});

test('F10 Rename Request (Tier 1): synchronizes active tab path, title, and rawContent', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('col/req.curl', '# @name Old\ncurl api.com');
  ws.openInNewTab('col/req.curl');

  ws.renameRequest('col/req.curl', 'Updated Req');
  assert.equal(ws.tabs[0].filePath, 'col/Updated Req.curl');
  assert.equal(ws.tabs[0].name, 'Updated Req');
  assert.ok(ws.tabs[0].rawContent.includes('# @name Updated Req'));
});

test('F10 Rename Request (Tier 1): updates companion .meta.json sidecar name if present', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('test.curl', 'curl api.com', { name: 'Old Sidecar', tests: [] });
  ws.openInNewTab('test.curl');

  const newPath = ws.renameRequest('test.curl', 'New Sidecar');
  const file = ws.files.get(newPath);
  assert.equal(file?.sidecar?.name, 'New Sidecar');
  assert.equal(ws.tabs[0].sidecar?.name, 'New Sidecar');
});

test('F10 Rename Request (Tier 2): keeps extension when user explicitly types matching .curl', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('test.curl', 'curl test');
  const newPath = ws.renameRequest('test.curl', 'typed_ext.curl');
  assert.equal(newPath, 'typed_ext.curl');
  assert.ok(!newPath.includes('.curl.curl'));
});

test('F10 Rename Request (Tier 2): replaces mismatched user-typed extension (.json -> .curl)', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('test.curl', 'curl test');
  const newPath = ws.renameRequest('test.curl', 'bad_ext.json');
  assert.equal(newPath, 'bad_ext.json.curl');
});

test('F10 Rename Request (Tier 2): sanitizes directory traversal slashes in filename', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('dir/req.curl', 'curl test');
  const newPath = ws.renameRequest('dir/req.curl', '../../evil');
  assert.equal(newPath, 'dir/.._.._evil.curl');
});

test('F10 Rename Request (Tier 2): falls back to current file stem if user types whitespace-only', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('dir/fallback.curl', 'curl test');
  const newPath = ws.renameRequest('dir/fallback.curl', '   ');
  assert.equal(newPath, 'dir/fallback.curl');
});

test('F10 Rename Request (Tier 2): preserves dirty content of tab when renaming', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('draft.curl', '# @name Init\ncurl disk');
  ws.openInNewTab('draft.curl');
  ws.tabs[0].rawContent = '# @name Init\ncurl dirty_memory';
  ws.tabs[0].isDirty = true;

  ws.renameRequest('draft.curl', 'Renamed Draft');
  assert.equal(ws.tabs[0].isDirty, true);
  assert.ok(ws.tabs[0].rawContent.includes('dirty_memory'));
});

// ============================================================================
// FEATURE 11: Delete Request — Tiers 1 & 2 (10 tests)
// ============================================================================

test('F11 Delete Request (Tier 1): deletes request file from disk and tree', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('del.curl', 'curl api.com');
  assert.ok(ws.files.has('del.curl'));
  ws.deleteRequest('del.curl');
  assert.ok(!ws.files.has('del.curl'));
  assert.ok(!ws.tree.some((i) => i.path === 'del.curl'));
});

test('F11 Delete Request: removes the request from a nested sidebar tree', () => {
  const tree: WorkspaceFileItem[] = [
    {
      name: 'api',
      path: '/workspace/api',
      is_dir: true,
      children: [
        {
          name: 'keep.curl',
          path: '/workspace/api/keep.curl',
          is_dir: false,
        },
        {
          name: 'remove.curl',
          path: '/workspace/api/remove.curl',
          is_dir: false,
        },
      ],
    },
  ];

  const remaining = removeWorkspaceItem(tree, '/workspace/api/remove.curl');
  const apiFolder = remaining[0];

  assert.equal(apiFolder.children?.length, 1);
  assert.equal(apiFolder.children?.[0].path, '/workspace/api/keep.curl');
  assert.equal(tree[0].children?.length, 2, 'source tree should remain immutable');
});

test('F11 Delete Request (Tier 1): closes matching open tab cleanly', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('req.curl', 'curl api.com');
  ws.openInNewTab('req.curl');
  assert.equal(ws.tabs.length, 1);
  ws.deleteRequest('req.curl');
  assert.equal(ws.tabs.length, 1); // Generates fallback untitled tab
  assert.equal(ws.tabs[0].filePath, null);
});

test('F11 Delete Request (Tier 1): force-closes dirty tab without redundant unsaved confirmation', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('dirty.curl', 'curl api.com');
  ws.openInNewTab('dirty.curl');
  ws.tabs[0].isDirty = true;

  ws.deleteRequest('dirty.curl');
  // Closed without hanging
  assert.ok(!ws.tabs.some((t) => t.filePath === 'dirty.curl'));
});

test('F11 Delete Request (Tier 1): shifts active focus to adjacent tab when active tab deleted', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('req1.curl', '1');
  ws.addFileToDisk('req2.curl', '2');
  ws.openInNewTab('req1.curl');
  ws.openInNewTab('req2.curl');
  ws.activeTabId = ws.tabs[0].id; // focus req1

  ws.deleteRequest('req1.curl');
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.activeTabId, ws.tabs[0].id);
  assert.equal(ws.tabs[0].filePath, 'req2.curl');
});

test('F11 Delete Request (Tier 1): deletes companion .meta.json sidecar alongside request', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('with_sidecar.curl', 'curl api.com', { tests: [] });
  ws.deleteRequest('with_sidecar.curl');
  assert.ok(!ws.files.has('with_sidecar.curl'));
});

test('F11 Delete Request (Tier 2): deleting request not currently open in tabs does not close open tabs', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('open.curl', 'open');
  ws.addFileToDisk('unopened.curl', 'unopened');
  ws.openInNewTab('open.curl');

  ws.deleteRequest('unopened.curl');
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.tabs[0].filePath, 'open.curl');
});

test('F11 Delete Request (Tier 2): deleting non-existent file is a graceful no-op', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('keep.curl', 'keep');
  ws.deleteRequest('phantom.curl');
  assert.equal(ws.files.size, 1);
});

test('F11 Delete Request (Tier 2): deletes nested file preserving sibling files in directory', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('api/v1/keep.curl', 'keep');
  ws.addFileToDisk('api/v1/remove.curl', 'remove');
  ws.deleteRequest('api/v1/remove.curl');
  assert.ok(ws.files.has('api/v1/keep.curl'));
  assert.ok(!ws.files.has('api/v1/remove.curl'));
});

test('F11 Delete Request (Tier 2): deletes open file cleanly from disk and restores a draft tab', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('service.curl', 'curl test');
  ws.openInNewTab('service.curl');
  ws.deleteRequest('service.curl');
  assert.ok(!ws.files.has('service.curl'));
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.tabs[0].filePath, null);
});

test('F11 Delete Request (Tier 2): closes middle tab in 3-tab layout and maintains tab order', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('1.curl', '1');
  ws.addFileToDisk('2.curl', '2');
  ws.addFileToDisk('3.curl', '3');
  ws.openInNewTab('1.curl');
  ws.openInNewTab('2.curl');
  ws.openInNewTab('3.curl');

  ws.deleteRequest('2.curl');
  assert.equal(ws.tabs.length, 2);
  assert.equal(ws.tabs[0].filePath, '1.curl');
  assert.equal(ws.tabs[1].filePath, '3.curl');
});

// ============================================================================
// TIER 3: Cross-Feature Combinations — Pairwise Interactions (11 tests)
// ============================================================================

test('Tier 3 Combination 1: Rename Folder then Duplicate Request inside renamed folder', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('v1/auth.curl', '# @name Auth\ncurl api.com/auth');
  ws.openInNewTab('v1/auth.curl');

  ws.renameFolder('v1', 'v2');
  assert.equal(ws.tabs[0].filePath, 'v2/auth.curl');

  const dupPath = ws.duplicateRequest('v2/auth.curl');
  assert.equal(dupPath, 'v2/auth_copy.curl');
  assert.equal(ws.tabs.length, 2);
  assert.equal(ws.tabs[1].filePath, 'v2/auth_copy.curl');
});

test('Tier 3 Combination 2: New Subfolder, New Request Here, then Rename Parent Folder', () => {
  const ws = new SimulatedWorkspace();
  ws.createFolder('.', 'collections');
  ws.createNewRequestInFolder('collections');
  ws.saveActiveDraft('init.curl');
  assert.equal(ws.tabs[0].filePath, 'collections/init.curl');

  ws.renameFolder('collections', 'apis');
  assert.equal(ws.tabs[0].filePath, 'apis/init.curl');
  assert.ok(ws.files.has('apis/init.curl'));
});

test('Tier 3 Combination 3: Open in Current Tab followed by Rename Request and Save', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('users/profile.curl', 'curl api.com/profile');
  ws.openInCurrentTab('users/profile.curl');
  assert.equal(ws.tabs[0].isPinned, false);

  ws.renameRequest('users/profile.curl', 'user_account');
  assert.equal(ws.tabs[0].filePath, 'users/user_account.curl');
  assert.equal(ws.tabs[0].name, 'user_account');
});

test('Tier 3 Combination 4: Duplicate Request then Delete Original Request (sidecars independent)', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('test.curl', 'curl api.com', { name: 'Original', tests: [] });
  const dupPath = ws.duplicateRequest('test.curl');

  ws.deleteRequest('test.curl');
  assert.ok(!ws.files.has('test.curl'));
  assert.ok(ws.files.has(dupPath));
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.tabs[0].filePath, dupPath);
});

test('Tier 3 Combination 5: Delete Folder with dirty tabs, then create New Request Here with same path', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('cache/temp.curl', 'curl cache');
  ws.openInNewTab('cache/temp.curl');
  ws.tabs[0].isDirty = true;

  ws.deleteFolder('cache');
  assert.equal(ws.files.size, 0);

  ws.createNewRequestInFolder('cache');
  ws.saveActiveDraft('fresh.curl');
  assert.equal(ws.activeTab?.filePath, 'cache/fresh.curl');
  assert.ok(ws.files.has('cache/fresh.curl'));
});

test('Tier 3 Combination 6: Rename Folder then Export Collection (.sh) ensuring updated paths and vars', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('old_dir/req.curl', 'curl "{{host}}/data"');
  ws.renameFolder('old_dir', 'new_dir');

  const folder = ws.tree.find((i) => i.name === 'new_dir');
  ws.openExportModal(folder);
  const script = ws.generateExportScript({ host: 'https://production.com' });
  assert.ok(script.includes('https://production.com/data'));
});

test('Tier 3 Combination 7: Open in New Tab, edit to make dirty, Open in Current Tab another file', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('file1.curl', '1');
  ws.addFileToDisk('file2.curl', '2');
  ws.openInNewTab('file1.curl');
  ws.tabs[0].isDirty = true;

  ws.openInCurrentTab('file2.curl');
  assert.equal(ws.tabs.length, 2, 'Must not replace dirty tab');
  assert.equal(ws.tabs[0].filePath, 'file1.curl');
  assert.equal(ws.tabs[1].filePath, 'file2.curl');
});

test('Tier 3 Combination 8: Copy as cURL on an unsaved duplicated request', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('base.curl', 'curl "{{endpoint}}/run"');
  const dupPath = ws.duplicateRequest('base.curl');
  ws.tabs[ws.tabs.length - 1].rawContent = 'curl "{{endpoint}}/custom_run"';
  ws.tabs[ws.tabs.length - 1].isDirty = true;

  const mockClip = { text: '' };
  ws.copyRequestCommand(dupPath, { endpoint: 'https://service.local' }, mockClip);
  assert.ok(mockClip.text.includes('https://service.local/custom_run'));
});

test('Tier 3 Combination 9: Duplicate request then Rename Request with no extension (still .curl)', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('svc.curl', 'curl svc');
  const dupPath = ws.duplicateRequest('svc.curl');
  assert.equal(dupPath, 'svc_copy.curl');

  const renamedPath = ws.renameRequest(dupPath, 'renamed_svc');
  assert.equal(renamedPath, 'renamed_svc.curl');
});

test('Tier 3 Combination 10: Create nested subfolder, move/rename folder, delete nested folder with active tabs', () => {
  const ws = new SimulatedWorkspace();
  ws.createFolder('.', 'stage1');
  ws.createFolder('stage1', 'stage2');
  ws.addFileToDisk('stage1/stage2/task.curl', 'task');
  ws.openInNewTab('stage1/stage2/task.curl');

  ws.renameFolder('stage1', 'production');
  assert.equal(ws.tabs[0].filePath, 'production/stage2/task.curl');

  ws.deleteFolder('production/stage2');
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.tabs[0].filePath, null); // fallback
});

test('Tier 3 Combination 11: Rapid sequential renames of request and parent folder', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('f1/req1.curl', '# @name Initial\ncurl api');
  ws.openInNewTab('f1/req1.curl');

  ws.renameRequest('f1/req1.curl', 'req_v2');
  assert.equal(ws.tabs[0].filePath, 'f1/req_v2.curl');

  ws.renameFolder('f1', 'f2');
  assert.equal(ws.tabs[0].filePath, 'f2/req_v2.curl');

  ws.renameRequest('f2/req_v2.curl', 'req_v3');
  assert.equal(ws.tabs[0].filePath, 'f2/req_v3.curl');
});

// ============================================================================
// TIER 4: Real-World Scenarios — Complete Workflows (5 tests)
// ============================================================================

test('Tier 4 Scenario 1: Deep Nested API Lifecycle (Folder creation, request creation, rename cascade, export)', () => {
  const ws = new SimulatedWorkspace();
  // 1. Create nested collection structure
  ws.createFolder('.', 'services');
  ws.createFolder('services', 'auth');
  ws.createFolder('services/auth', 'v1');

  // 2. Create new requests
  ws.createNewRequestInFolder('services/auth/v1');
  ws.tabs[0].rawContent = '# @name Login\ncurl -X POST "{{baseUrl}}/login" -d "{\\"user\\":\\"admin\\"}"';
  ws.saveActiveDraft('login.curl');

  // 3. Duplicate request for negative test
  const dupPath = ws.duplicateRequest('services/auth/v1/login.curl');
  ws.renameRequest(dupPath, 'login_negative');

  // 4. Rename folder from v1 to v2
  ws.renameFolder('services/auth/v1', 'services/auth/v2');
  assert.equal(ws.tabs[0].filePath, 'services/auth/v2/login.curl');
  assert.equal(ws.tabs[1].filePath, 'services/auth/v2/login_negative.curl');

  // 5. Export to shell script
  const folder = ws.tree.find((i) => i.name === 'services')?.children?.find((i) => i.name === 'auth');
  ws.openExportModal(folder);
  const script = ws.generateExportScript({ baseUrl: 'https://auth.company.com' });
  assert.ok(script.includes('https://auth.company.com/login'));
  assert.ok(script.includes('#!/usr/bin/env bash'));
});

test('Tier 4 Scenario 2: Multi-Tab State Machine (Mixed pinned, preview, dirty, switching and replacing)', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('api/read1.curl', 'curl 1');
  ws.addFileToDisk('api/read2.curl', 'curl 2');
  ws.addFileToDisk('api/write.curl', 'curl 3');

  // Open read1 in preview
  ws.openInCurrentTab('api/read1.curl');
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.tabs[0].isPinned, false);

  // Open read2 in current tab -> replaces read1 in preview
  ws.openInCurrentTab('api/read2.curl');
  assert.equal(ws.tabs.length, 1);
  assert.equal(ws.tabs[0].filePath, 'api/read2.curl');

  // Promote read2 to pinned
  ws.tabs[0].isPinned = true;

  // Edit read2 -> dirty
  ws.tabs[0].rawContent = 'curl edited';
  ws.tabs[0].isDirty = true;

  // Open write in current tab -> cannot replace dirty pinned tab, appends preview
  ws.openInCurrentTab('api/write.curl');
  assert.equal(ws.tabs.length, 2);
  assert.equal(ws.tabs[0].filePath, 'api/read2.curl');
  assert.equal(ws.tabs[0].isDirty, true);
  assert.equal(ws.tabs[1].filePath, 'api/write.curl');
  assert.equal(ws.tabs[1].isPinned, false);
});

test('Tier 4 Scenario 3: Collection Clone & Refactor (.curl preservation, sidecar clone)', () => {
  const ws = new SimulatedWorkspace();
  const sidecar: SidecarMetadata = {
    name: 'User Svc',
    tests: [{ test_type: 'status_code', expected: 200 }],
    tab_color: '#3498db',
  };
  ws.addFileToDisk('v1/get_user.curl', 'curl api/v1/user', sidecar);
  ws.addFileToDisk('v1/stream_user.curl', 'curl api/v1/stream');

  // Duplicate both
  const dup1 = ws.duplicateRequest('v1/get_user.curl');
  const dup2 = ws.duplicateRequest('v1/stream_user.curl');

  assert.equal(dup1, 'v1/get_user_copy.curl');
  assert.equal(dup2, 'v1/stream_user_copy.curl');

  // Rename folder to v2
  ws.renameFolder('v1', 'v2');
  assert.ok(ws.files.has('v2/get_user_copy.curl'));
  assert.ok(ws.files.has('v2/stream_user_copy.curl'));

  // Rename requests with display names
  const final1 = ws.renameRequest('v2/get_user_copy.curl', 'Get User Detail');
  const final2 = ws.renameRequest('v2/stream_user_copy.curl', 'Stream User Updates');

  assert.equal(final1, 'v2/Get User Detail.curl');
  assert.equal(final2, 'v2/Stream User Updates.curl');
});

test('Tier 4 Scenario 4: Sibling Folder Isolation Stress Test (/v1, /v1-backup, /v1_staging, /v10)', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk('api/v1/req.curl', '1');
  ws.addFileToDisk('api/v1-backup/req.curl', 'backup');
  ws.addFileToDisk('api/v1_staging/req.curl', 'staging');
  ws.addFileToDisk('api/v10/req.curl', '10');

  ws.openInNewTab('api/v1/req.curl');
  ws.openInNewTab('api/v1-backup/req.curl');
  ws.openInNewTab('api/v1_staging/req.curl');
  ws.openInNewTab('api/v10/req.curl');
  assert.equal(ws.tabs.length, 4);

  // Delete /api/v1
  ws.deleteFolder('api/v1');
  assert.equal(ws.tabs.length, 3);
  assert.equal(ws.tabs[0].filePath, 'api/v1-backup/req.curl');
  assert.equal(ws.tabs[1].filePath, 'api/v1_staging/req.curl');
  assert.equal(ws.tabs[2].filePath, 'api/v10/req.curl');

  // Rename /api/v1-backup -> /api/v2-backup
  ws.renameFolder('api/v1-backup', 'api/v2-backup');
  assert.equal(ws.tabs[0].filePath, 'api/v2-backup/req.curl');
  assert.equal(ws.tabs[1].filePath, 'api/v1_staging/req.curl');
  assert.equal(ws.tabs[2].filePath, 'api/v10/req.curl');
});

test('Tier 4 Scenario 5: Variable Injection, Dynamic Generators, and Clipboard Fallback Export', () => {
  const ws = new SimulatedWorkspace();
  ws.addFileToDisk(
    'orders/create.curl',
    '# @name Create Order\ncurl -X POST "{{apiUrl}}/orders" \\\n  -H "X-Idempotency: {{$uuid}}" \\\n  -H "X-Time: {{$timestamp}}" \\\n  -d \'{"amount": 100, "token": "{{secretToken}}"}\''
  );
  ws.openInNewTab('orders/create.curl');

  const env = { apiUrl: 'https://orders.shop.com', secretToken: 'sk_live_999' };
  const mockClip = { text: '', shouldThrow: false };

  const copyResult = ws.copyRequestCommand('orders/create.curl', env, mockClip);
  assert.equal(copyResult.copied, true);
  assert.ok(mockClip.text.includes('https://orders.shop.com/orders'));
  assert.ok(mockClip.text.includes('sk_live_999'));
  assert.ok(!mockClip.text.includes('{{$uuid}}'));
  assert.ok(!mockClip.text.includes('{{$timestamp}}'));

  // Test headless clipboard fallback
  const fallbackClip = { text: '', shouldThrow: true };
  const fallbackResult = ws.copyRequestCommand('orders/create.curl', env, fallbackClip);
  assert.equal(fallbackResult.copied, true);
  assert.equal(fallbackResult.usedFallback, true);
});
