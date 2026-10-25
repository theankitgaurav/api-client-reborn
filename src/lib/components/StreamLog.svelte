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

<div class="flex flex-col h-full overflow-hidden text-xs bg-white dark:bg-[#1a1a1a]">
  <!-- Top Stream Toolbar -->
  <div class="p-2 bg-[#f9f9fb] dark:bg-[#202020] border-b border-[#e5e5e5] dark:border-[#2d2d2d] flex items-center justify-between text-neutral-600 dark:text-neutral-400">
    <div class="flex items-center gap-2 font-medium">
      <Radio size={13} class={responseState.isExecuting ? 'text-emerald-500 animate-pulse' : 'text-neutral-400 dark:text-neutral-500'} />
      <span class="text-neutral-800 dark:text-neutral-200">
        {responseState.isExecuting ? 'Receiving Live Stream...' : 'Stream Event Log'}
      </span>
      <span class="bg-blue-50 dark:bg-[#2d2d2d] text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-transparent text-[10px] px-1.5 py-0.5 rounded-full font-mono font-semibold">
        {responseState.streamMessages.length} events
      </span>
    </div>

    <div class="flex items-center gap-2">
      <label class="flex items-center gap-1 text-[11px] text-neutral-600 dark:text-neutral-400 cursor-pointer select-none">
        <input type="checkbox" bind:checked={autoScroll} class="rounded bg-white dark:bg-[#2a2a2a] border-neutral-300 dark:border-[#444] text-blue-600" />
        <span>Auto-scroll</span>
      </label>
      {#if responseState.streamMessages.length > 0}
        <button
          onclick={clearStream}
          title="Clear events"
          class="p-1 text-neutral-500 hover:text-rose-500 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      {/if}
    </div>
  </div>

  <!-- Messages List -->
  <div
    bind:this={scrollContainer}
    class="flex-1 overflow-y-auto p-2 space-y-2 bg-[#fafafa] dark:bg-[#161616]"
  >
    {#each responseState.streamMessages as msg, idx}
      <div class="bg-white dark:bg-[#202020] border border-[#e5e5e5] dark:border-[#2e2e2e] rounded p-2.5 flex flex-col gap-1.5 shadow-sm">
        <div class="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
          <div class="flex items-center gap-2">
            <span class="font-mono text-neutral-400 dark:text-neutral-500 text-[10px]">#{idx + 1}</span>
            <span class="font-semibold text-xs px-1.5 py-0.2 rounded {msg.event === 'chunk' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'}">
              {msg.event || 'message'}
            </span>
            {#if msg.id}
              <span class="text-neutral-400 dark:text-neutral-500 font-mono text-[10px]">id: {msg.id}</span>
            {/if}
            {#if msg.bytes}
              <span class="text-neutral-400 dark:text-neutral-500 font-mono text-[10px]">{msg.bytes} B</span>
            {/if}
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono">{msg.timestamp}</span>
            <button
              onclick={() => copyData(msg.data, idx)}
              title="Copy payload"
              class="text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
            >
              {#if copiedIndex === idx}
                <Check size={12} class="text-emerald-500" />
              {:else}
                <Copy size={12} />
              {/if}
            </button>
          </div>
        </div>
        <pre class="bg-[#f5f5f7] dark:bg-[#121212] border border-[#ebebeb] dark:border-transparent p-2 rounded text-[12px] font-mono text-neutral-800 dark:text-neutral-200 overflow-x-auto whitespace-pre-wrap selection:bg-blue-600/30">{msg.data}</pre>
      </div>
    {/each}

    {#if responseState.streamMessages.length === 0}
      <div class="text-center py-16 text-neutral-400 dark:text-neutral-500 flex flex-col items-center gap-2">
        <Radio size={24} class="text-neutral-300 dark:text-neutral-600" />
        <p class="text-xs font-medium">No streaming events recorded yet.</p>
        <p class="text-[11px] text-neutral-400 dark:text-neutral-500">Execute a streaming request (SSE or chunked transfer) to see real-time frames.</p>
      </div>
    {/if}
  </div>
</div>
