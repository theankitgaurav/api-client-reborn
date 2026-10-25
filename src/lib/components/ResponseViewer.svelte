<script lang="ts">
  import { responseState } from '$lib/state/response.svelte';
  import StreamLog from './StreamLog.svelte';
  import {
    Activity,
    Copy,
    Check,
    Clock,
    HardDrive,
    AlertTriangle,
  } from 'lucide-svelte';

  let copied = $state(false);

  function copyBody() {
    navigator.clipboard.writeText(responseState.bodyText);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 1500);
  }

  function getStatusBadge(status: number | null) {
    if (!status) return 'bg-neutral-800 text-neutral-400';
    if (status >= 200 && status < 300) return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    if (status >= 300 && status < 400) return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
    if (status >= 400 && status < 500) return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
    return 'bg-rose-500/20 text-rose-400 border border-rose-500/30';
  }

  function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
</script>

<div class="flex-1 flex flex-col h-full bg-[#1e1e1e] overflow-hidden text-xs">
  <!-- Response Top Metric Bar -->
  <div class="px-3 py-2 bg-[#252526] border-b border-[#2d2d2d] flex items-center justify-between">
    <div class="flex items-center space-x-3">
      {#if responseState.status}
        <span class="px-2 py-0.5 rounded font-mono font-bold text-xs {getStatusBadge(responseState.status)}">
          {responseState.status} {responseState.statusText}
        </span>
      {:else if responseState.isExecuting}
        <span class="px-2 py-0.5 rounded font-mono text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse">
          Sending...
        </span>
      {:else}
        <span class="text-neutral-500 text-xs">No response yet</span>
      {/if}

      {#if responseState.durationMs !== null}
        <span class="flex items-center gap-1 text-neutral-400 text-[11px]">
          <Clock size={11} class="text-neutral-500" />
          {responseState.durationMs}ms
        </span>
      {/if}

      {#if responseState.totalBytes > 0}
        <span class="flex items-center gap-1 text-neutral-400 text-[11px]">
          <HardDrive size={11} class="text-neutral-500" />
          {formatBytes(responseState.totalBytes)}
        </span>
      {/if}
    </div>

    <!-- Tab Selector -->
    <div class="flex items-center space-x-1 bg-[#1c1c1c] p-0.5 rounded border border-[#333]">
      <button
        onclick={() => (responseState.activeTab = 'body')}
        class="px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors {responseState.activeTab === 'body'
          ? 'bg-[#2f2f2f] text-white shadow-sm'
          : 'text-neutral-400 hover:text-neutral-200'}"
      >
        Body
      </button>
      <button
        onclick={() => (responseState.activeTab = 'headers')}
        class="px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors {responseState.activeTab === 'headers'
          ? 'bg-[#2f2f2f] text-white shadow-sm'
          : 'text-neutral-400 hover:text-neutral-200'}"
      >
        Headers ({responseState.headers.length})
      </button>
      <button
        onclick={() => (responseState.activeTab = 'stream')}
        class="px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors {responseState.activeTab === 'stream'
          ? 'bg-[#2f2f2f] text-white shadow-sm'
          : 'text-neutral-400 hover:text-neutral-200'}"
      >
        Stream ({responseState.sseMessages.length})
      </button>
      <button
        onclick={() => (responseState.activeTab = 'raw')}
        class="px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors {responseState.activeTab === 'raw'
          ? 'bg-[#2f2f2f] text-white shadow-sm'
          : 'text-neutral-400 hover:text-neutral-200'}"
      >
        Raw
      </button>
    </div>
  </div>

  <!-- Error Alert if present -->
  {#if responseState.error}
    <div class="p-3 bg-rose-950/40 border-b border-rose-800/40 flex items-start gap-2 text-rose-300">
      <AlertTriangle size={15} class="shrink-0 mt-0.5" />
      <div>
        <p class="font-semibold text-xs">Request Failed</p>
        <p class="text-[11px] font-mono mt-0.5">{responseState.error}</p>
      </div>
    </div>
  {/if}

  <!-- Tab Content -->
  <div class="flex-1 relative overflow-hidden">
    {#if responseState.activeTab === 'body'}
      <div class="h-full flex flex-col">
        <div class="px-3 py-1 bg-[#181818] border-b border-[#2d2d2d] flex justify-end">
          <button
            onclick={copyBody}
            title="Copy Response Body"
            class="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            {#if copied}
              <Check size={12} class="text-emerald-400" />
              <span>Copied</span>
            {:else}
              <Copy size={12} />
              <span>Copy</span>
            {/if}
          </button>
        </div>
        <pre class="flex-1 p-3 m-0 font-mono text-[12px] leading-relaxed overflow-auto text-neutral-200 select-text">{responseState.bodyText || '// No response body'}</pre>
      </div>
    {:else if responseState.activeTab === 'headers'}
      <div class="h-full overflow-y-auto p-3">
        <table class="w-full text-left font-mono text-[11px]">
          <thead>
            <tr class="text-neutral-500 border-b border-[#333]">
              <th class="pb-1.5 font-semibold w-1/3">Header Name</th>
              <th class="pb-1.5 font-semibold">Value</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#2a2a2a]">
            {#each responseState.headers as h}
              <tr class="hover:bg-[#252526]">
                <td class="py-1.5 text-blue-400 select-text">{h.key}</td>
                <td class="py-1.5 text-neutral-300 select-text break-all">{h.value}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if responseState.headers.length === 0}
          <div class="text-center py-8 text-neutral-500">No response headers</div>
        {/if}
      </div>
    {:else if responseState.activeTab === 'stream'}
      <StreamLog />
    {:else if responseState.activeTab === 'raw'}
      <pre class="h-full p-3 m-0 font-mono text-[12px] overflow-auto text-neutral-300 select-text">{responseState.bodyText}</pre>
    {/if}
  </div>
</div>
