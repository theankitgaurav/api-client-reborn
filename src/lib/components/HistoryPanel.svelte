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
    if (status === null) return 'text-rose-500 dark:text-rose-400';
    if (status >= 200 && status < 300) return 'text-emerald-600 dark:text-emerald-400';
    if (status >= 300 && status < 400) return 'text-blue-600 dark:text-blue-400';
    if (status >= 400) return 'text-amber-600 dark:text-amber-400';
    return 'text-neutral-500';
  }
</script>

<div class="flex-1 min-h-0 flex flex-col">
  <div class="p-2 border-b border-[#e5e5e5] dark:border-[#2d2d2d] flex items-center gap-1.5">
    <div class="relative w-full">
      <Search size={13} class="absolute left-2 top-2 text-neutral-400" />
      <input
        id="history-filter-input"
        type="text"
        placeholder="Search history..."
        value={historyState.searchQuery}
        oninput={(event) => {
          historyState.searchQuery = (event.currentTarget as HTMLInputElement).value;
        }}
        class="w-full bg-white dark:bg-[#202020] border border-[#d2d2d7] dark:border-[#303030] rounded pl-7 pr-2 py-1 text-xs text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:border-blue-500 shadow-sm"
      />
    </div>
    {#if isConfirmingClear}
      <span class="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-400">Clear all?</span>
      <button
        type="button"
        onclick={() => (isConfirmingClear = false)}
        disabled={isClearing}
        class="shrink-0 rounded px-1.5 py-1 text-[10px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-[#303030] disabled:opacity-40"
      >
        Cancel
      </button>
      <button
        type="button"
        onclick={clearHistory}
        disabled={historyState.entries.length === 0 || isClearing}
        class="shrink-0 flex items-center gap-1 rounded border border-rose-300 dark:border-rose-900 px-1.5 py-1 text-[10px] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-40"
      >
        <Trash2 size={11} />
        <span>{isClearing ? 'Clearing' : 'Clear all'}</span>
      </button>
    {:else}
      <button
        type="button"
        onclick={() => (isConfirmingClear = true)}
        disabled={historyState.entries.length === 0 || isClearing}
        title="Clear all history"
        aria-label="Clear all history"
        class="shrink-0 flex items-center gap-1 rounded border border-[#d2d2d7] dark:border-[#383838] px-1.5 py-1 text-[10px] text-neutral-600 dark:text-neutral-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 size={11} />
        <span>Clear</span>
      </button>
    {/if}
  </div>

  <div class="flex-1 overflow-y-auto p-1.5 space-y-1">
    {#if historyState.isLoading}
      <div class="text-center py-6 text-neutral-400 dark:text-neutral-500">Loading history...</div>
    {:else if filteredEntries.length === 0}
      <div class="text-center py-8 text-neutral-400 dark:text-neutral-500 text-xs">
        {historyState.searchQuery ? 'No matching history' : 'No requests sent yet'}
      </div>
    {:else}
      {#each filteredEntries as entry (entry.id)}
        <details class="rounded border border-[#e5e5e5] dark:border-[#303030] bg-white/70 dark:bg-[#202020]">
          <summary
            class="list-none cursor-pointer px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-[#282828] rounded"
            title="Load request and response"
            onclick={() => workspaceState.openHistoryEntry(entry)}
          >
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="font-mono font-bold text-[9px] text-blue-600 dark:text-blue-400 shrink-0">{entry.method}</span>
              <span class="truncate text-[11px] text-neutral-800 dark:text-neutral-200" title={entry.url || entry.request_name}>
                {entry.request_name}
              </span>
              <span class="ml-auto text-[10px] font-mono shrink-0 {statusClass(entry.status)}">
                {entry.status ?? 'ERR'}
              </span>
            </div>
            <div class="flex items-center gap-1 mt-1 text-[10px] text-neutral-400 dark:text-neutral-500">
              <Clock size={10} />
              <span class="truncate">{formatTimestamp(entry.timestamp)}</span>
            </div>
          </summary>

          <div class="px-2 pb-2 space-y-2 text-[10px] text-neutral-600 dark:text-neutral-400">
            <div class="font-mono break-all text-neutral-700 dark:text-neutral-300">{entry.url || 'URL unavailable'}</div>
            {#if entry.error}
              <div class="flex gap-1 text-rose-600 dark:text-rose-400">
                <AlertCircle size={12} class="shrink-0" />
                <span class="break-all">{entry.error}</span>
              </div>
            {/if}
            <details>
              <summary class="cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-200">Request</summary>
              <pre class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-100 dark:bg-[#181818] p-1.5 font-mono">{entry.raw_command}</pre>
            </details>
            <details>
              <summary class="cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-200">Response</summary>
              {#if entry.response_file_path}
                <p class="mt-1 text-[10px] text-neutral-500">Full response is stored on disk. Select this history item to open it and export the saved stream.</p>
              {/if}
              <pre class="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-100 dark:bg-[#181818] p-1.5 font-mono">{entry.response_body || '// No response body'}</pre>
            </details>
          </div>
        </details>
      {/each}
    {/if}
  </div>
</div>
