import {
  createCollectionFolder,
  deleteWorkspaceItem,
  duplicateRequestFile,
  getWorkspacePath,
  readRequestFile,
  renameWorkspaceItem,
  saveRequestFile,
  scanWorkspace,
} from '../ipc';
import type { FileDetails, SidecarMetadata, TestResultItem, WorkspaceFileItem } from '../types';

export interface TabResponseData {
  status: number | null;
  statusText: string;
  protocol: string;
  ttfbMs: number | null;
  durationMs: number | null;
  totalBytes: number;
  headers: { key: string; value: string }[];
  bodyText: string;
  streamMessages: any[];
  error: string | null;
  activeTab: 'body' | 'headers' | 'stream' | 'tests' | 'raw';
  testResults: TestResultItem[];
  scriptLogs: string[];
}

export interface TabItem {
  id: string;
  filePath: string | null; // null if unsaved draft
  name: string;
  method: string;
  rawContent: string;
  isDirty: boolean;
  isPinned: boolean;       // false = preview tab; true = pinned tab
  sidecar?: SidecarMetadata;
  response?: TabResponseData;
}

export class WorkspaceState {
  workspacePath = $state('.');
  tree = $state<WorkspaceFileItem[]>([]);
  tabs = $state<TabItem[]>([]);
  activeTabId = $state<string | null>(null);
  isLoading = $state(false);
  isSaveModalOpen = $state(false);
  isImportModalOpen = $state(false);
  isExportModalOpen = $state(false);
  exportTargetFolder = $state<WorkspaceFileItem | null>(null);
  targetNewRequestFolder = $state<string>('.');

  // Active tab derivation
  activeTab = $derived(this.tabs.find((t) => t.id === this.activeTabId) || null);

  // Backward compatibility getters
  get activeFilePath(): string | null {
    return this.activeTab?.filePath ?? null;
  }
  get activeFile(): FileDetails | null {
    if (!this.activeTab) return null;
    return {
      path: this.activeTab.filePath || '',
      raw_content: this.activeTab.rawContent,
      metadata: {
        name: this.activeTab.name,
        method: this.activeTab.method,
      },
      sidecar: this.activeTab.sidecar,
    };
  }
  get isDirty(): boolean {
    return this.activeTab?.isDirty ?? false;
  }

  constructor() {
    this.refreshTree();
  }

  async refreshTree() {
    this.isLoading = true;
    try {
      if (this.workspacePath === '.' || !this.workspacePath) {
        try {
          this.workspacePath = await getWorkspacePath();
        } catch {
          // fallback to '.' if IPC fails
        }
      }
      this.tree = await scanWorkspace(this.workspacePath);
      // Auto-open first request if no tabs exist
      if (this.tabs.length === 0 && this.tree.length > 0) {
        const first = this.findFirstRequest(this.tree);
        if (first) {
          await this.openRequest(first.path, false);
        }
      }
    } catch (e) {
      console.error('Failed to load workspace:', e);
    } finally {
      this.isLoading = false;
    }
  }

  findFirstRequest(items: WorkspaceFileItem[]): WorkspaceFileItem | null {
    for (const item of items) {
      if (!item.is_dir) return item;
      if (item.children) {
        const found = this.findFirstRequest(item.children);
        if (found) return found;
      }
    }
    return null;
  }

  private inferMethod(content: string): string {
    const match = content.match(/-X\s+([A-Za-z]+)/);
    if (match) return match[1].toUpperCase();
    if (content.includes('-d ') || content.includes('--data')) return 'POST';
    return 'GET';
  }

  private inferName(path: string, content: string): string {
    const nameMatch = content.match(/#\s*@name\s+(.+)/);
    if (nameMatch) return nameMatch[1].trim();
    const fileName = path.split('/').pop() || 'Request';
    return fileName.replace('.curl', '').replace(/[-_]/g, ' ');
  }

  async openRequest(path: string, openInNewTab: boolean = false) {
    // 1. Check if already open in a tab
    const existing = this.tabs.find((t) => t.filePath === path);
    if (existing) {
      this.activeTabId = existing.id;
      if (openInNewTab) {
        existing.isPinned = true;
      }
      return;
    }

    // 2. Read from disk
    try {
      const details = await readRequestFile(path);
      const name = details.metadata.name || this.inferName(path, details.raw_content);
      const method = details.metadata.method || this.inferMethod(details.raw_content);

      if (openInNewTab) {
        const newTab: TabItem = {
          id: crypto.randomUUID(),
          filePath: path,
          name,
          method,
          rawContent: details.raw_content,
          isDirty: false,
          isPinned: true,
          sidecar: details.sidecar,
        };
        this.tabs.push(newTab);
        this.activeTabId = newTab.id;
      } else {
        // Reuse unpinned preview tab if available and not dirty
        const previewTab = this.tabs.find((t) => !t.isPinned && !t.isDirty);
        if (previewTab) {
          previewTab.filePath = path;
          previewTab.name = name;
          previewTab.method = method;
          previewTab.rawContent = details.raw_content;
          previewTab.isDirty = false;
          previewTab.sidecar = details.sidecar;
          previewTab.response = undefined;
          this.activeTabId = previewTab.id;
        } else {
          const newTab: TabItem = {
            id: crypto.randomUUID(),
            filePath: path,
            name,
            method,
            rawContent: details.raw_content,
            isDirty: false,
            isPinned: false, // preview tab
            sidecar: details.sidecar,
          };
          this.tabs.push(newTab);
          this.activeTabId = newTab.id;
        }
      }
    } catch (e) {
      console.error('Failed to open request file:', e);
    }
  }

  // Alias for backward compatibility
  async openFile(path: string) {
    await this.openRequest(path, false);
  }

  createNewRequest() {
    const defaultContent = `# @name Untitled Request\n# @timeout 30000\n\ncurl -X GET "https://httpbin.org/get" \\\n  -H "Accept: application/json"`;
    const newTab: TabItem = {
      id: crypto.randomUUID(),
      filePath: null,
      name: 'Untitled Request',
      method: 'GET',
      rawContent: defaultContent,
      isDirty: false,
      isPinned: true,
      sidecar: { tests: [] },
    };
    this.tabs.push(newTab);
    this.activeTabId = newTab.id;
  }

  closeTab(tabId: string) {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;

    const tab = this.tabs[idx];
    if (tab.isDirty) {
      const confirmClose = confirm(`"${tab.name}" has unsaved changes. Close anyway?`);
      if (!confirmClose) return;
    }

    this.tabs.splice(idx, 1);

    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const nextIdx = Math.min(idx, this.tabs.length - 1);
        this.activeTabId = this.tabs[nextIdx].id;
      } else {
        this.createNewRequest();
      }
    }
  }

  closeOtherTabs(tabId: string) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      this.tabs = [tab];
      this.activeTabId = tab.id;
    }
  }

  closeTabsToTheRight(tabId: string) {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx >= 0) {
      this.tabs = this.tabs.slice(0, idx + 1);
      if (!this.tabs.some((t) => t.id === this.activeTabId)) {
        this.activeTabId = tabId;
      }
    }
  }

  pinTab(tabId: string) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.isPinned = true;
    }
  }

  updateContent(newContent: string, method?: string, name?: string) {
    if (!this.activeTab) return;
    this.activeTab.rawContent = newContent;
    this.activeTab.isDirty = true;
    this.activeTab.isPinned = true; // Pin once user makes changes
    if (method) this.activeTab.method = method;
    if (name) this.activeTab.name = name;
  }

  async saveActiveFile() {
    if (!this.activeTab) return;
    if (!this.activeTab.filePath) {
      // Open Save Request Modal for unsaved draft
      this.isSaveModalOpen = true;
      return;
    }

    try {
      await saveRequestFile(
        this.activeTab.filePath,
        this.activeTab.rawContent,
        this.activeTab.sidecar
      );
      this.activeTab.isDirty = false;
      await this.refreshTree();
    } catch (e) {
      console.error('Failed to save file:', e);
    }
  }

  async saveActiveFileAs(filePath: string, name: string) {
    if (!this.activeTab) return;
    try {
      this.activeTab.filePath = filePath;
      this.activeTab.name = name;
      await saveRequestFile(
        filePath,
        this.activeTab.rawContent,
        this.activeTab.sidecar
      );
      this.activeTab.isDirty = false;
      this.isSaveModalOpen = false;
      await this.refreshTree();
    } catch (e) {
      console.error('Failed to save file as:', e);
    }
  }

  createNewRequestInFolder(folderPath: string) {
    this.targetNewRequestFolder = folderPath;
    this.createNewRequest();
  }

  async createFolder(parentPath: string, folderName: string) {
    try {
      await createCollectionFolder(parentPath, folderName);
      await this.refreshTree();
    } catch (e) {
      console.error('Failed to create folder:', e);
      alert(`Failed to create folder: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async deleteItem(itemPath: string, displayName?: string) {
    const isFolder = !itemPath.endsWith('.curl') && !itemPath.endsWith('.grpcurl');
    const label = displayName || itemPath.split('/').pop() || itemPath;
    const confirmed = confirm(
      `Are you sure you want to delete ${isFolder ? 'folder' : 'request'} "${label}"?${
        isFolder ? ' All contained requests will be deleted.' : ''
      }`
    );
    if (!confirmed) return;

    try {
      await deleteWorkspaceItem(itemPath);

      // Close tab if deleted request is currently open
      const openTab = this.tabs.find((t) => t.filePath === itemPath);
      if (openTab) {
        this.closeTab(openTab.id);
      } else if (isFolder) {
        // Close any tabs inside deleted folder
        const tabsToClose = this.tabs.filter(
          (t) => t.filePath && t.filePath.startsWith(itemPath)
        );
        for (const t of tabsToClose) {
          this.closeTab(t.id);
        }
      }

      await this.refreshTree();
    } catch (e) {
      console.error('Failed to delete item:', e);
      alert(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async renameItem(oldPath: string, currentName: string) {
    const newName = prompt('Enter new name:', currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;

    try {
      const newPath = await renameWorkspaceItem(oldPath, newName.trim());
      const displayName = newName.trim().replace(/\.(curl|grpcurl)$/, '');

      // Update tab(s) if open
      for (const tab of this.tabs) {
        if (tab.filePath === oldPath) {
          tab.filePath = newPath;
          tab.name = displayName;
          if (tab.rawContent.match(/#\s*@name\s+.+/)) {
            tab.rawContent = tab.rawContent.replace(
              /#\s*@name\s+.+/,
              `# @name ${displayName}`
            );
          } else {
            tab.rawContent = `# @name ${displayName}\n${tab.rawContent}`;
          }
          if (tab.sidecar) {
            tab.sidecar.name = displayName;
          }
        } else if (tab.filePath && tab.filePath.startsWith(oldPath + '/')) {
          tab.filePath = newPath + tab.filePath.slice(oldPath.length);
        }
      }

      await this.refreshTree();
    } catch (e) {
      console.error('Failed to rename item:', e);
      alert(`Failed to rename: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async duplicateRequest(sourcePath: string) {
    try {
      const newPath = await duplicateRequestFile(sourcePath);
      await this.refreshTree();
      await this.openRequest(newPath, true);
    } catch (e) {
      console.error('Failed to duplicate request:', e);
      alert(`Failed to duplicate: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  openExportModal(folder?: WorkspaceFileItem) {
    this.exportTargetFolder = folder ?? null;
    this.isExportModalOpen = true;
  }

  openImportModal() {
    this.isImportModalOpen = true;
  }
}

export const workspaceState = new WorkspaceState();
