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
import {
  cascadeFolderRename,
  filterTabsOnFolderDelete,
  resolveTargetTabForOpenCurrent,
  sanitizeRequestRename,
  updateRequestNameHeader,
  type TabItem,
  type TabResponseData,
} from '../utils/workspace-sync';

export type { TabItem, TabResponseData };

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

  private inferMethod(content: string, _path?: string): string {
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
      const method = details.metadata.method || this.inferMethod(details.raw_content, path);

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
        const { tabToReplace } = resolveTargetTabForOpenCurrent(
          this.tabs,
          this.activeTabId
        );
        if (tabToReplace) {
          tabToReplace.filePath = path;
          tabToReplace.name = name;
          tabToReplace.method = method;
          tabToReplace.rawContent = details.raw_content;
          tabToReplace.isDirty = false;
          tabToReplace.sidecar = details.sidecar;
          tabToReplace.response = undefined;
          this.activeTabId = tabToReplace.id;
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

  closeActiveTab() {
    if (this.activeTabId) {
      this.closeTab(this.activeTabId);
    }
  }

  nextTab() {
    if (this.tabs.length <= 1) return;
    const idx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    const nextIdx = idx === -1 ? 0 : (idx + 1) % this.tabs.length;
    this.activeTabId = this.tabs[nextIdx].id;
  }

  previousTab() {
    if (this.tabs.length <= 1) return;
    const idx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    const prevIdx = idx === -1 ? 0 : (idx - 1 + this.tabs.length) % this.tabs.length;
    this.activeTabId = this.tabs[prevIdx].id;
  }

  selectTabByIndex(index: number) {
    if (index >= 0 && index < this.tabs.length) {
      this.activeTabId = this.tabs[index].id;
    }
  }

  closeTab(tabId: string, force: boolean = false) {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;

    const tab = this.tabs[idx];
    if (!force && tab.isDirty) {
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
    const isFolder = !itemPath.endsWith('.curl');
    const label = displayName || itemPath.split('/').pop() || itemPath;
    const confirmed = confirm(
      `Are you sure you want to delete ${isFolder ? 'folder' : 'request'} "${label}"?${
        isFolder ? ' All contained requests will be deleted.' : ''
      }`
    );
    if (!confirmed) return;

    try {
      await deleteWorkspaceItem(itemPath);

      if (isFolder) {
        const { remainingTabs, closedTabs } = filterTabsOnFolderDelete(this.tabs, itemPath);
        if (closedTabs.length > 0) {
          const closedIds = new Set(closedTabs.map((t) => t.id));
          this.tabs = remainingTabs;
          if (closedIds.has(this.activeTabId || '')) {
            this.activeTabId = this.tabs.length > 0 ? this.tabs[0].id : null;
            if (!this.activeTabId) {
              this.createNewRequest();
            }
          }
        }
      } else {
        const openTab = this.tabs.find((t) => t.filePath === itemPath);
        if (openTab) {
          this.closeTab(openTab.id, true);
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
      const isFolder = !oldPath.endsWith('.curl');

      if (isFolder) {
        const newPath = await renameWorkspaceItem(oldPath, newName.trim());
        this.tabs = cascadeFolderRename(this.tabs, oldPath, newPath);

        const normOld = oldPath.replace(/[\\\/]+$/, '');
        const normNew = newPath.replace(/[\\\/]+$/, '');
        if (this.targetNewRequestFolder === normOld) {
          this.targetNewRequestFolder = normNew;
        } else if (this.targetNewRequestFolder.startsWith(normOld + '/')) {
          this.targetNewRequestFolder =
            normNew + this.targetNewRequestFolder.slice(normOld.length);
        }
      } else {
        const sanitized = sanitizeRequestRename(oldPath, newName.trim());
        const newPath = await renameWorkspaceItem(oldPath, sanitized);
        const displayName = sanitized.replace(/\.curl$/, '');

        const openTab = this.tabs.find((t) => t.filePath === oldPath);
        if (openTab) {
          openTab.filePath = newPath;
          openTab.name = displayName;
          openTab.rawContent = updateRequestNameHeader(openTab.rawContent, displayName);
          if (openTab.sidecar) {
            openTab.sidecar.name = displayName;
          }
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
