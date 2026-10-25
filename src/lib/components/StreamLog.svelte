<script lang="ts">
  import { responseState } from '$lib/state/response.svelte';
  import { Radio, Copy, Check } from 'lucide-svelte';

  let copiedIndex = $state<number | null>(null);

  function copyData(data: string, index: number) {
    navigator.clipboard.writeText(data);
    copiedIndex = index;
    setTimeout(() => {
      copiedIndex = null;
    }, 1500);
  }
</script>

<div class="flex flex-col h-full overflow-hidden text-xs">
  <div class="p-2 bg-[#202020] border-b border-[#2d2d2d] flex items-center justify-between text-neutral-400">
    <div class="flex items-center gap-1.5 font-medium">
      <Radio size={13} class={responseState.isExecuting ? 'text-emerald-400 animate-pulse' : 'text-neutral-500'} />
      <span>Live Event Stream</span>
      <span class="bg-[#2d2d2d] text-neutral-300 text-[10px] px-1.5 py-0.2 rounded-full font-mono">
        {responseState.sseMessages.length} events
      </span>
    </div>
  </div>

  <div class="flex-1 overflow-y-auto divide-y divide-[#282828]">
    {#each responseState.sseMessages as msg, idx}
      <div class="p-2.5 hover:bg-[#202020] transition-colors flex flex-col gap-1">
        <div class="flex items-center justify-between text-[11px] text-neutral-400">
          <div class="flex items-center gap-2">
            <span class="font-mono text-neutral-500">#{idx + 1}</span>
            <span class="font-semibold text-blue-400">{msg.event || 'message'}</span>
            {#if msg.id}
              <span class="text-neutral-500 font-mono text-[10px]">id: {msg.id}</span>
            {/if}
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-neutral-500">{msg.timestamp}</span>
            <button
              onclick={() => copyData(msg.data, idx)}
              title="Copy payload"
              class="text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              {#if copiedIndex === idx}
                <Check size={12} class="text-emerald-400" />
              {:else}
                <Copy size={12} />
              {/if}
            </button>
          </div>
        </div>
        <pre class="bg-[#181818] p-2 rounded text-[12px] font-mono text-neutral-200 overflow-x-auto whitespace-pre-wrap">{msg.data}</pre>
      </div>
    {/each}

    {#if responseState.sseMessages.length === 0}
      <div class="text-center py-10 text-neutral-500">
        No stream events received yet
      </div>
    {/if}
  </div>
</div>
