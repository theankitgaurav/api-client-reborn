<script lang="ts">
  import { historyState } from '$lib/state/history.svelte';
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { AlertCircle, Clock, Search, Trash2 } from '$lib/components/icons';

  $effect(() => {
    void historyState.load(workspaceState.workspacePath);
  });

  let filteredEntries = $derived(historyState.filteredEntries);
  let isClearing = $state(false);
  let isConfirmingClear = $state(false);

  async function clearHistory() {
    if (!historyState.entries.length || isClearing || !isConfirmingClear) return;

    isClearing = true;
    try {
      await historyState.clear(workspaceState.workspacePath);
      isConfirmingClear = false;
    } catch (error) {
      console.error('Failed to clear request history:', error);
      alert(`Failed to clear history: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      isClearing = false;
    }
  }

  function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    return date.toLocaleString();
  }

  function statusClass(status: number | null): string {
    if (status === null) return 'text-[var(--danger)]';
    if (status >= 200 && status < 300) return 'text-[var(--success)]';
    if (status >= 300 && status < 400) return 'text-[var(--accent)]';
    if (status >= 400) return 'text-[var(--warning)]';
    return 'text-[var(--text-muted)]';
  }
</script>

<div class="flex-1 min-h-0 flex flex-col text-xs">
  <div class="p-2 border-b border-[var(--border)] flex items-center gap-1.5">
    <div class="relative w-full">
      <Search size={12} class="absolute left-2 top-2 text-[var(--text-subtle)]" />
      <input
        id="history-filter-input"
        type="text"
        placeholder="Search history…"
        value={historyState.searchQuery}
        oninput={(event) => {
          historyState.searchQuery = (event.currentTarget as HTMLInputElement).value;
        }}
        class="w-full bg-[var(--surface)] border border-[var(--border)] rounded pl-6.5 pr-2 py-1 text-[11px] text-[var(--text-strong)] placeholder:text-[var(--text-subtle)] outline-none focus:border-[var(--focus)] transition-colors"
      />
    </div>
    {#if isConfirmingClear}
      <span class="shrink-0 text-[10px] text-[var(--text-muted)]">Clear all?</span>
      <button
        type="button"
        onclick={() => (isConfirmingClear = false)}
        disabled={isClearing}
        class="shrink-0 rounded px-1.5 py-1 text-[10px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
      >
        Cancel
      </button>
      <button
        type="button"
        onclick={clearHistory}
        disabled={historyState.entries.length === 0 || isClearing}
        class="shrink-0 flex items-center gap-1 rounded bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] px-1.5 py-1 text-[10px] text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_22%,transparent)] disabled:opacity-40"
      >
        <Trash2 size={11} />
        <span>{isClearing ? 'Clearing…' : 'Clear all'}</span>
      </button>
    {:else}
      <button
        type="button"
        onclick={() => (isConfirmingClear = true)}
        disabled={historyState.entries.length === 0 || isClearing}
        title="Clear all history"
        aria-label="Clear all history"
        class="shrink-0 flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 size={11} />
        <span>Clear</span>
      </button>
    {/if}
  </div>

  <div class="flex-1 overflow-y-auto p-1.5 space-y-1">
    {#if historyState.isLoading}
      <div class="text-center py-6 text-[11px] text-[var(--text-subtle)]">Loading history…</div>
    {:else if filteredEntries.length === 0}
      <div class="text-center py-8 text-[11px] text-[var(--text-subtle)]">
        {historyState.searchQuery ? 'No matching history' : 'No requests sent yet'}
      </div>
    {:else}
      {#each filteredEntries as entry (entry.id)}
        <details class="rounded border border-[var(--border)] bg-[var(--surface)] text-[11px] overflow-hidden">
          <summary
            class="list-none cursor-pointer px-2 py-1.5 hover:bg-[var(--surface-hover)] transition-colors"
            title="Load request and response"
            onclick={() => workspaceState.openHistoryEntry(entry)}
          >
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="font-mono font-bold text-[9px] text-[var(--accent)] shrink-0">{entry.method}</span>
              <span class="truncate text-[11px] text-[var(--text-strong)] font-medium" title={entry.url || entry.request_name}>
                {entry.request_name}
              </span>
              <span class="ml-auto text-[10px] font-mono shrink-0 font-bold {statusClass(entry.status)}">
                {entry.status ?? 'ERR'}
              </span>
            </div>
            <div class="flex items-center gap-1 mt-0.5 text-[10px] text-[var(--text-muted)]">
              <Clock size={10} />
              <span class="truncate">{formatTimestamp(entry.timestamp)}</span>
            </div>
          </summary>

          <div class="px-2 pb-2 pt-1 border-t border-[var(--border)] space-y-1.5 text-[10px] text-[var(--text-muted)] bg-[var(--surface-muted)]">
            <div class="font-mono break-all text-[var(--text)]">{entry.url || 'URL unavailable'}</div>
            {#if entry.error}
              <div class="flex gap-1 text-[var(--danger)]">
                <AlertCircle size={12} class="shrink-0" />
                <span class="break-all">{entry.error}</span>
              </div>
            {/if}
            <details>
              <summary class="cursor-pointer hover:text-[var(--text-strong)]">Request</summary>
              <pre class="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--surface)] border border-[var(--border)] p-1.5 font-mono">{entry.raw_command}</pre>
            </details>
            <details>
              <summary class="cursor-pointer hover:text-[var(--text-strong)]">Response</summary>
              {#if entry.response_file_path}
                <p class="mt-1 text-[10px] text-[var(--text-subtle)]">Full response is stored on disk. Select this history item to open it and export the saved stream.</p>
              {/if}
              <pre class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--surface)] border border-[var(--border)] p-1.5 font-mono">{entry.response_body || '// No response body'}</pre>
            </details>
          </div>
        </details>
      {/each}
    {/if}
  </div>
</div>
