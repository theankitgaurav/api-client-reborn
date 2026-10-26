import { appendRequestHistory, clearRequestHistory, getRequestHistory } from '../ipc';
import type { RequestHistoryEntry } from '../types';

export class HistoryState {
  entries = $state<RequestHistoryEntry[]>([]);
  searchQuery = $state('');
  isLoading = $state(false);
  private loadedWorkspacePath = '';
  private loadGeneration = 0;
  private persistenceQueue: Promise<void> = Promise.resolve();

  private enqueuePersistence(operation: () => Promise<void>): Promise<void> {
    const pending = this.persistenceQueue.then(operation, operation);
    this.persistenceQueue = pending.catch(() => {});
    return pending;
  }

  get filteredEntries(): RequestHistoryEntry[] {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return this.entries;

    return this.entries.filter((entry) => {
      const searchable = [
        entry.request_name,
        entry.request_path || '',
        entry.method,
        entry.url,
        entry.status === null ? '' : String(entry.status),
        entry.status_text,
        entry.raw_command,
        entry.response_body,
        entry.error || '',
      ];
      return searchable.some((value) => value.toLowerCase().includes(query));
    });
  }

  async load(workspacePath: string) {
    if (this.loadedWorkspacePath === workspacePath) return;
    this.loadedWorkspacePath = workspacePath;
    const generation = ++this.loadGeneration;
    this.isLoading = true;
    try {
      const entries = await getRequestHistory(workspacePath);
      if (generation === this.loadGeneration) this.entries = entries;
    } catch (error) {
      console.error('Failed to load request history:', error);
      if (generation === this.loadGeneration) this.entries = [];
    } finally {
      if (generation === this.loadGeneration) this.isLoading = false;
    }
  }

  async record(workspacePath: string, entry: RequestHistoryEntry) {
    this.loadGeneration++;
    this.isLoading = false;
    this.entries = [entry, ...this.entries.filter((existing) => existing.id !== entry.id)];
    try {
      await this.enqueuePersistence(() => appendRequestHistory(workspacePath, entry));
    } catch (error) {
      console.error('Failed to save request history:', error);
    }
  }

  async clear(workspacePath: string) {
    const previousEntries = this.entries;
    this.loadGeneration++;
    this.isLoading = false;
    this.entries = [];
    try {
      await this.enqueuePersistence(() => clearRequestHistory(workspacePath));
    } catch (error) {
      if (this.entries.length === 0) this.entries = previousEntries;
      throw error;
    }
  }
}

export const historyState = new HistoryState();
