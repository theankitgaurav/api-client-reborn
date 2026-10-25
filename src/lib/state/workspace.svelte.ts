import { readRequestFile, saveRequestFile, scanWorkspace } from '../ipc';
import type { FileDetails, WorkspaceFileItem } from '../types';

export class WorkspaceState {
  workspacePath = $state('.');
  tree = $state<WorkspaceFileItem[]>([]);
  activeFilePath = $state<string | null>(null);
  activeFile = $state<FileDetails | null>(null);
  isDirty = $state(false);
  isLoading = $state(false);

  constructor() {
    this.refreshTree();
  }

  async refreshTree() {
    this.isLoading = true;
    try {
      this.tree = await scanWorkspace(this.workspacePath);
      // Auto-open first request if none open
      if (!this.activeFilePath && this.tree.length > 0) {
        const first = this.findFirstRequest(this.tree);
        if (first) {
          await this.openFile(first.path);
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

  async openFile(path: string) {
    if (this.activeFilePath === path) return;
    try {
      this.activeFile = await readRequestFile(path);
      this.activeFilePath = path;
      this.isDirty = false;
    } catch (e) {
      console.error('Failed to open file:', e);
    }
  }

  updateContent(newContent: string) {
    if (!this.activeFile) return;
    this.activeFile.raw_content = newContent;
    this.isDirty = true;
  }

  async saveActiveFile() {
    if (!this.activeFile || !this.activeFilePath) return;
    try {
      await saveRequestFile(
        this.activeFilePath,
        this.activeFile.raw_content,
        this.activeFile.sidecar
      );
      this.isDirty = false;
      await this.refreshTree();
    } catch (e) {
      console.error('Failed to save file:', e);
    }
  }
}

export const workspaceState = new WorkspaceState();
