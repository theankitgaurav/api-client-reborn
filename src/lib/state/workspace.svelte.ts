import {
  createCollectionFolder,
  deleteWorkspaceItem,
  duplicateRequestFile,
  getWorkspacePath,
  moveWorkspaceItem,
  readRequestFile,
  renameWorkspaceItem,
  saveRequestDisplayName,
  saveRequestFile,
  setWorkspacePath,
  scanWorkspace,
} from '../ipc';
import type { FileDetails, RequestHistoryEntry, SidecarMetadata, TestResultItem, WorkspaceFileItem } from '../types';
import { createDefaultGrpcRequest, parseGrpcRequest, serializeGrpcRequest } from '../utils/grpc.ts';
import {
  cascadeFolderRename,
  filterTabsOnFolderDelete,
  openHistoryEntryInTabs,
  removeWorkspaceItem,
  resolveTargetTabForOpenCurrent,
  sanitizeRequestRename,
  updateRequestNameHeader,
  type TabItem,
  type TabResponseData,
} from '../utils/workspace-sync';

export type { TabItem, TabResponseData };

function createDefaultHttpRequestContent(name: string, method: string) {
  return `# @name ${name}\n# @timeout 30000\n\ncurl -X ${method} "https://httpbin.org/get" \\\n  -H "Accept: application/json"`;
}

export class WorkspaceState {
  workspacePath = $state('.');
  tree = $state<WorkspaceFileItem[]>([]);
  tabs = $state<TabItem[]>([]);
  activeTabId = $state<string | null>(null);
  isLoading = $state(false);
  workspaceError = $state<string | null>(null);
  isSaveModalOpen = $state(false);
  isImportModalOpen = $state(false);
  isExportModalOpen = $state(false);
  isMcpModalOpen = $state(false);
  exportTargetFolder = $state<WorkspaceFileItem | null>(null);
  targetNewRequestFolder = $state<string>('.');
  onTabsRetired: ((ids: string[]) => void) | null = null;
  private refreshRequestId = 0;
  private nameOnlyEdits = new WeakMap<TabItem, string>();
  private requestSaveQueues = new Map<string, Promise<void>>();

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
    const refreshRequestId = ++this.refreshRequestId;
    this.isLoading = true;
    try {
      if (this.workspacePath === '.' || !this.workspacePath) {
        try {
          this.workspacePath = await getWorkspacePath();
          this.workspaceError = null;
        } catch (error) {
          this.workspaceError = error instanceof Error ? error.message : String(error);
          // fallback to '.' if IPC fails
        }
      }
      const scannedTree = await scanWorkspace(this.workspacePath);
      // A delete/rename can start another refresh while this scan is in
      // flight. Never let an older scan put a stale item back in the pane.
      if (refreshRequestId !== this.refreshRequestId) return;
      this.tree = scannedTree;
    } catch (e) {
      this.workspaceError = e instanceof Error ? e.message : String(e);
      console.error('Failed to load workspace:', e);
    } finally {
      if (refreshRequestId === this.refreshRequestId) {
        this.isLoading = false;
      }
    }
  }

  async switchWorkspace(path: string, dirtyHandled = false) {
    const scannedTree = await scanWorkspace(path);
    if (!dirtyHandled && this.isDirty) {
      const choice = prompt('Unsaved request: type “save”, “discard”, or “cancel”.', 'cancel')?.trim().toLowerCase();
      if (choice === 'cancel' || !choice) return false;
      if (choice === 'save') {
        await this.saveActiveFile();
        if (this.isDirty || this.isSaveModalOpen) return false;
      } else if (choice !== 'discard') return false;
    }
    const newPath = await setWorkspacePath(path);
    this.onTabsRetired?.(this.tabs.map((tab) => tab.id));
    this.workspacePath = newPath;
    this.tree = scannedTree;
    this.tabs = [];
    this.activeTabId = null;
    this.targetNewRequestFolder = path;
    return true;
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
      const requestType = /\.(?:grpcurl|grpc)$/i.test(path) ? 'grpc' : 'http';
      const grpcConfig = requestType === 'grpc' ? parseGrpcRequest(details.raw_content) : null;
      const name = grpcConfig?.name || details.metadata.name || this.inferName(path, details.raw_content);
      const method = grpcConfig ? 'gRPC' : details.metadata.method || this.inferMethod(details.raw_content, path);

      if (openInNewTab) {
        const newTab: TabItem = {
          id: crypto.randomUUID(),
          filePath: path,
          name,
          method,
          requestType,
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
          this.onTabsRetired?.([tabToReplace.id]);
          tabToReplace.filePath = path;
          tabToReplace.name = name;
          tabToReplace.method = method;
          tabToReplace.requestType = requestType;
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
            requestType,
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

  openHistoryEntry(entry: RequestHistoryEntry) {
    const opened = openHistoryEntryInTabs(
      this.tabs,
      this.activeTabId,
      entry,
      crypto.randomUUID()
    );
    const remaining = new Set(opened.tabs.map((tab) => tab.id));
    this.onTabsRetired?.(this.tabs.filter((tab) => !remaining.has(tab.id)).map((tab) => tab.id));
    this.tabs = opened.tabs;
    this.activeTabId = opened.activeTabId;
  }

  createNewRequest(method = 'GET') {
    const newTab: TabItem = {
      id: crypto.randomUUID(),
      filePath: null,
      name: 'Untitled Request',
      method,
      requestType: 'http',
      rawContent: createDefaultHttpRequestContent('Untitled Request', method),
      isDirty: false,
      isPinned: true,
      sidecar: { tests: [] },
    };
    this.tabs.push(newTab);
    this.activeTabId = newTab.id;
  }

  switchRequestType(requestType: 'http' | 'grpc', method = 'GET') {
    const tab = this.activeTab;
    if (!tab || (tab.requestType || 'http') === requestType) return;

    if (tab.filePath) {
      if (requestType === 'grpc') {
        this.createNewGrpcRequest();
      } else {
        this.createNewRequest(method);
      }
      return;
    }

    if (requestType === 'grpc') {
      const config = createDefaultGrpcRequest(tab.name);
      tab.rawContent = serializeGrpcRequest(config);
      tab.method = 'gRPC';
      tab.requestType = 'grpc';
    } else {
      tab.rawContent = createDefaultHttpRequestContent(tab.name, method);
      tab.method = method;
      tab.requestType = 'http';
    }

    tab.isDirty = true;
    tab.isPinned = true;
  }

  createNewGrpcRequest() {
    const config = createDefaultGrpcRequest();
    const newTab: TabItem = {
      id: crypto.randomUUID(),
      filePath: null,
      name: config.name,
      method: 'gRPC',
      requestType: 'grpc',
      rawContent: serializeGrpcRequest(config),
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

    this.onTabsRetired?.([tabId]);
    this.tabs.splice(idx, 1);

    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const nextIdx = Math.min(idx, this.tabs.length - 1);
        this.activeTabId = this.tabs[nextIdx].id;
      } else {
        this.activeTabId = null;
      }
    }
  }

  closeOtherTabs(tabId: string) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      this.onTabsRetired?.(this.tabs.filter((item) => item.id !== tabId).map((item) => item.id));
      this.tabs = [tab];
      this.activeTabId = tab.id;
    }
  }

  closeTabsToTheRight(tabId: string) {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx >= 0) {
      this.onTabsRetired?.(this.tabs.slice(idx + 1).map((tab) => tab.id));
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

  updateContent(newContent: string, method?: string, name?: string, nameEdit = false) {
    if (!this.activeTab) return;
    if (nameEdit && !this.activeTab.isDirty) {
      this.nameOnlyEdits.set(this.activeTab, JSON.stringify(this.activeTab.sidecar ?? null));
    } else if (!nameEdit) {
      this.nameOnlyEdits.delete(this.activeTab);
    }
    this.activeTab.rawContent = newContent;
    this.activeTab.isDirty = true;
    this.activeTab.isPinned = true; // Pin once user makes changes
    if (method) this.activeTab.method = method;
    if (name !== undefined) this.activeTab.name = name;
  }

  private queueRequestSave(path: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.requestSaveQueues.get(path);
    // The earlier save reports its own failure; a later save should still be attempted.
    const save = (previous ? previous.catch(() => {}) : Promise.resolve()).then(operation);
    this.requestSaveQueues.set(path, save);
    void save.then(
      () => { if (this.requestSaveQueues.get(path) === save) this.requestSaveQueues.delete(path); },
      () => { if (this.requestSaveQueues.get(path) === save) this.requestSaveQueues.delete(path); },
    );
    return save;
  }

  async saveActiveRequestName(): Promise<boolean> {
    const tab = this.activeTab;
    if (!tab) return false;
    const enteredName = tab.name;
    const name = enteredName.trim();
    if (!name) {
      alert('Request name cannot be empty.');
      return false;
    }
    if (!tab.filePath) return true;
    const path = tab.filePath;
    const requestType = tab.requestType;
    const content = tab.rawContent;
    const sidecar = JSON.stringify(tab.sidecar ?? null);
    const nameOnly = this.nameOnlyEdits.get(tab) === sidecar;
    try {
      await this.queueRequestSave(path, () => saveRequestDisplayName(path, name, requestType));
      if (this.tabs.includes(tab) && tab.filePath === path) {
        const unchanged = tab.name === enteredName && tab.rawContent === content
          && JSON.stringify(tab.sidecar ?? null) === sidecar;
        if (tab.sidecar?.name !== undefined && tab.name.trim() === name) tab.sidecar.name = name;
        if (nameOnly && unchanged && this.nameOnlyEdits.get(tab) === sidecar) {
          tab.isDirty = false;
          this.nameOnlyEdits.delete(tab);
        }
      }
      await this.refreshTree();
      return true;
    } catch (error) {
      console.error('Failed to save request name:', error);
      alert(`Failed to save request name: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async saveActiveFile() {
    const tab = this.activeTab;
    if (!tab) return;
    if (!tab.filePath) {
      // Open Save Request Modal for unsaved draft
      this.isSaveModalOpen = true;
      return;
    }

    const path = tab.filePath;
    const content = tab.rawContent;
    const name = tab.name;
    const sidecarSnapshot = JSON.stringify(tab.sidecar ?? null);
    const sidecar: SidecarMetadata | undefined = tab.sidecar ? JSON.parse(sidecarSnapshot) : undefined;
    if (sidecar?.name !== undefined && name.trim()) sidecar.name = name.trim();
    try {
      await this.queueRequestSave(path, () => saveRequestFile(path, content, sidecar));
      const currentSidecar = JSON.stringify(tab.sidecar ?? null);
      if (this.tabs.includes(tab) && tab.filePath === path && tab.rawContent === content
          && tab.name === name && (currentSidecar === sidecarSnapshot || currentSidecar === JSON.stringify(sidecar ?? null))) {
        if (tab.sidecar?.name !== undefined && sidecar?.name !== undefined) tab.sidecar.name = sidecar.name;
        tab.isDirty = false;
        this.nameOnlyEdits.delete(tab);
      }
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
      const path = await createCollectionFolder(parentPath, folderName);
      await this.refreshTree();
      return path;
    } catch (e) {
      console.error('Failed to create folder:', e);
      throw e;
    }
  }

  async moveItem(itemPath: string, destination: string) {
    const newPath = await moveWorkspaceItem(itemPath, destination);
    this.tabs = cascadeFolderRename(this.tabs, itemPath, newPath);
    const prefix = itemPath.replace(/[\\/]+$/, '');
    if (this.targetNewRequestFolder === prefix || this.targetNewRequestFolder.startsWith(`${prefix}/`)) {
      this.targetNewRequestFolder = newPath + this.targetNewRequestFolder.slice(prefix.length);
    }
    await this.refreshTree();
  }

  async deleteItem(itemPath: string, displayName?: string) {
    const isFolder = !/\.(curl|grpc|grpcurl)$/i.test(itemPath);
    const label = displayName || itemPath.split(/[\\/]/).pop() || itemPath;

    try {
      await deleteWorkspaceItem(itemPath);

      // Remove the item immediately after the storage operation succeeds so
      // the request pane reflects the deletion even if a filesystem rescan
      // is delayed or overlaps with another refresh.
      this.tree = removeWorkspaceItem(this.tree, itemPath);

      if (isFolder) {
        const { remainingTabs, closedTabs } = filterTabsOnFolderDelete(this.tabs, itemPath);
        if (closedTabs.length > 0) {
          const closedIds = new Set(closedTabs.map((t) => t.id));
          this.onTabsRetired?.([...closedIds]);
          this.tabs = remainingTabs;
          if (closedIds.has(this.activeTabId || '')) {
            this.activeTabId = this.tabs.length > 0 ? this.tabs[0].id : null;
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
      alert(`Failed to delete "${label}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async renameItem(oldPath: string, newName: string, isFolder: boolean) {
    if (!newName.trim()) return;

    try {
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
        const displayName = sanitized.replace(/\.(?:curl|grpc|grpcurl)$/i, '');

        const openTab = this.tabs.find((t) => t.filePath === oldPath);
        if (openTab) {
          openTab.filePath = newPath;
          openTab.name = displayName;
          if (openTab.requestType === 'grpc') {
            const config = parseGrpcRequest(openTab.rawContent);
            config.name = displayName;
            openTab.rawContent = serializeGrpcRequest(config);
          } else {
            openTab.rawContent = updateRequestNameHeader(openTab.rawContent, displayName);
          }
          if (openTab.sidecar) {
            openTab.sidecar.name = displayName;
          }
        }
      }

      await this.refreshTree();
    } catch (e) {
      console.error('Failed to rename item:', e);
      throw e;
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
