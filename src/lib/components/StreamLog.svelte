<script lang="ts">
  import { responseState } from '$lib/state/response.svelte';
  import { Radio, Copy, Check, Trash2 } from '$lib/components/icons';

  let copiedIndex = $state<number | null>(null);
  let autoScroll = $state(true);
  let scrollContainer: HTMLDivElement | null = $state(null);

  function copyData(data: string, index: number) {
    navigator.clipboard.writeText(data);
    copiedIndex = index;
    setTimeout(() => {
      copiedIndex = null;
    }, 1500);
  }

  function clearStream() {
    responseState.streamMessages = [];
  }

  // Auto-scroll to bottom on new messages if autoScroll is enabled
  $effect(() => {
    if (autoScroll && scrollContainer && responseState.streamMessages.length > 0) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  });
</script>

<div class="flex flex-col h-full overflow-hidden text-xs bg-[var(--surface)]">
  <!-- Top Stream Toolbar -->
  <div class="p-2 bg-[var(--surface-muted)] border-b border-[var(--border)] flex items-center justify-between text-[var(--text-muted)]">
    <div class="flex items-center gap-2 font-medium">
      <Radio size={13} class={responseState.isExecuting ? 'text-[var(--success)] animate-pulse' : 'text-[var(--text-subtle)]'} />
      <span class="text-[var(--text-strong)] font-semibold">
        {responseState.isExecuting ? 'Receiving Live Stream…' : 'Stream Event Log'}
      </span>
      <span class="bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)] border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] text-[10px] px-1.5 py-0.2 rounded font-mono font-semibold">
        {#if responseState.totalEventsCount > responseState.streamMessages.length}
          {responseState.streamMessages.length} / {responseState.totalEventsCount.toLocaleString()} events
        {:else}
          {responseState.streamMessages.length} events
        {/if}
      </span>
    </div>

    <div class="flex items-center gap-2">
      <label class="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer select-none">
        <input type="checkbox" bind:checked={autoScroll} class="rounded accent-[var(--accent)]" />
        <span>Auto-scroll</span>
      </label>
      {#if responseState.streamMessages.length > 0}
        <button
          onclick={clearStream}
          title="Clear events"
          aria-label="Clear stream"
          class="ui-icon-button"
        >
          <Trash2 size={13} />
        </button>
      {/if}
    </div>
  </div>

  {#if responseState.totalEventsCount > responseState.streamMessages.length}
    <div class="px-3 py-1 bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border-b border-[var(--border)] text-[11px] text-[var(--accent)] flex items-center justify-between">
      <span>
        ⚡ High-volume stream: displaying latest <strong>{responseState.streamMessages.length}</strong> of <strong>{responseState.totalEventsCount.toLocaleString()}</strong> events.
      </span>
    </div>
  {/if}

  <!-- Messages List -->
  <div
    bind:this={scrollContainer}
    class="flex-1 overflow-y-auto p-2 space-y-2 bg-[var(--bg)]"
  >
    {#each responseState.streamMessages as msg, idx}
      <div class="bg-[var(--surface)] border border-[var(--border)] rounded-md p-2.5 flex flex-col gap-1.5 shadow-sm">
        <div class="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <div class="flex items-center gap-2">
            <span class="font-mono text-[var(--text-subtle)] text-[10px]">#{idx + 1}</span>
            <span class="font-semibold text-[10px] px-1.5 py-0.2 rounded {msg.event === 'chunk' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'}">
              {msg.event || 'message'}
            </span>
            {#if msg.id}
              <span class="text-[var(--text-subtle)] font-mono text-[10px]">id: {msg.id}</span>
            {/if}
            {#if msg.bytes}
              <span class="text-[var(--text-subtle)] font-mono text-[10px]">{msg.bytes} B</span>
            {/if}
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-[var(--text-subtle)] font-mono">{msg.timestamp}</span>
            <button
              onclick={() => copyData(msg.data, idx)}
              title="Copy payload"
              class="text-[var(--text-muted)] hover:text-[var(--text-strong)] transition-colors"
            >
              {#if copiedIndex === idx}
                <Check size={12} class="text-[var(--success)]" />
              {:else}
                <Copy size={12} />
              {/if}
            </button>
          </div>
        </div>
        <pre class="bg-[var(--surface-muted)] border border-[var(--border)] p-2 rounded text-xs font-mono text-[var(--text-strong)] overflow-x-auto whitespace-pre-wrap">{msg.data}</pre>
      </div>
    {/each}

    {#if responseState.streamMessages.length === 0}
      <div class="text-center py-16 text-[var(--text-subtle)] flex flex-col items-center gap-2">
        <Radio size={24} class="opacity-50" />
        <p class="text-xs font-medium text-[var(--text-strong)]">No streaming events recorded yet.</p>
        <p class="text-[11px] text-[var(--text-muted)]">Execute a streaming request (SSE or chunked transfer) to see real-time frames.</p>
      </div>
    {/if}
  </div>
</div>
