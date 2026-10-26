import { appendRequestHistory, clearRequestHistory, getRequestHistory } from '../ipc';
import type { RequestHistoryEntry } from '../types';

export class HistoryState {
  entries = $state<RequestHistoryEntry[]>([]);
  searchQuery = $state('');
  isLoading = $state(false);
  private loadedWorkspacePath = '';

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
    this.isLoading = true;
    try {
      this.entries = await getRequestHistory(workspacePath);
    } catch (error) {
      console.error('Failed to load request history:', error);
      this.entries = [];
    } finally {
      this.isLoading = false;
    }
  }

  async record(workspacePath: string, entry: RequestHistoryEntry) {
    this.entries = [entry, ...this.entries.filter((existing) => existing.id !== entry.id)];
    try {
      await appendRequestHistory(workspacePath, entry);
    } catch (error) {
      console.error('Failed to save request history:', error);
    }
  }

  async clear(workspacePath: string) {
    await clearRequestHistory(workspacePath);
    this.entries = [];
  }
}

export const historyState = new HistoryState();
