<script lang="ts">
  import { responseState } from '$lib/state/response.svelte';
  import { workspaceState } from '$lib/state/workspace.svelte';
  import StreamLog from './StreamLog.svelte';
  import {
    Copy,
    Check,
    Clock,
    HardDrive,
    AlertTriangle,
  } from '$lib/components/icons';

  let copied = $state(false);

  // Sync response when switching tabs
  $effect(() => {
    responseState.loadTab(workspaceState.activeTabId);
  });

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

<div class="flex-1 flex flex-col h-full bg-white dark:bg-[#1e1e1e] overflow-hidden text-xs">
  <!-- Response Top Metric Bar -->
  <div class="px-3 py-2 bg-[#f9f9fb] dark:bg-[#252526] border-b border-[#e5e5e5] dark:border-[#2d2d2d] flex items-center justify-between">
    <div class="flex items-center space-x-3">
      {#if responseState.status}
        <span class="px-2 py-0.5 rounded font-mono font-bold text-xs {getStatusBadge(responseState.status)}">
          {responseState.status} {responseState.statusText}
        </span>
      {:else if responseState.isExecuting}
        <span class="px-2 py-0.5 rounded font-mono text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 animate-pulse font-medium">
          Sending...
        </span>
      {:else}
        <span class="text-neutral-500 text-xs">No response yet</span>
      {/if}

      {#if responseState.isStreaming && responseState.isExecuting}
        <span class="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 animate-pulse">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
          Streaming live
        </span>
      {/if}

      {#if responseState.durationMs !== null}
        <span class="flex items-center gap-1 text-neutral-600 dark:text-neutral-400 text-[11px]">
          <Clock size={11} class="text-neutral-400 dark:text-neutral-500" />
          {responseState.durationMs}ms
        </span>
      {/if}

      {#if responseState.totalBytes > 0}
        <span class="flex items-center gap-1 text-neutral-600 dark:text-neutral-400 text-[11px]">
          <HardDrive size={11} class="text-neutral-400 dark:text-neutral-500" />
          {formatBytes(responseState.totalBytes)}
        </span>
      {/if}
    </div>

    <!-- Tab Selector -->
    <div class="flex items-center space-x-1 bg-[#f0f0f2] dark:bg-[#1c1c1c] p-0.5 rounded border border-[#d2d2d7] dark:border-[#333]">
      <button
        onclick={() => (responseState.activeTab = 'body')}
        class="px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors {responseState.activeTab === 'body'
          ? 'bg-white dark:bg-[#2f2f2f] text-neutral-900 dark:text-white shadow-sm'
          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'}"
      >
        Body
      </button>
      <button
        onclick={() => (responseState.activeTab = 'headers')}
        class="px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors {responseState.activeTab === 'headers'
          ? 'bg-white dark:bg-[#2f2f2f] text-neutral-900 dark:text-white shadow-sm'
          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'}"
      >
        Headers ({responseState.headers.length})
      </button>
      <button
        onclick={() => (responseState.activeTab = 'stream')}
        class="px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors {responseState.activeTab === 'stream'
          ? 'bg-white dark:bg-[#2f2f2f] text-neutral-900 dark:text-white shadow-sm'
          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'}"
      >
        Stream ({responseState.streamMessages.length})
      </button>
      <button
        onclick={() => (responseState.activeTab = 'tests')}
        class="flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors {responseState.activeTab === 'tests'
          ? 'bg-white dark:bg-[#2f2f2f] text-neutral-900 dark:text-white shadow-sm'
          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'}"
      >
        <span>Tests</span>
        {#if responseState.testResults.length > 0}
          {@const allPassed = responseState.testResults.every((t) => t.passed)}
          {@const passCount = responseState.testResults.filter((t) => t.passed).length}
          <span
            class="px-1 py-0.2 rounded text-[10px] font-mono font-bold {allPassed
              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'}"
          >
            {passCount}/{responseState.testResults.length}
          </span>
        {/if}
      </button>
      <button
        onclick={() => (responseState.activeTab = 'raw')}
        class="px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors {responseState.activeTab === 'raw'
          ? 'bg-white dark:bg-[#2f2f2f] text-neutral-900 dark:text-white shadow-sm'
          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'}"
      >
        Raw
      </button>
    </div>
  </div>

  <!-- Error Alert if present -->
  {#if responseState.error}
    <div class="p-3 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-800/40 flex items-start gap-2 text-rose-700 dark:text-rose-300">
      <AlertTriangle size={15} class="shrink-0 mt-0.5" />
      <div>
        <p class="font-semibold text-xs">Request Failed</p>
        <p class="text-[11px] font-mono mt-0.5">{responseState.error}</p>
      </div>
    </div>
  {/if}

  <!-- Tab Content -->
  <div class="flex-1 relative overflow-hidden bg-white dark:bg-[#181818]">
    {#if responseState.activeTab === 'body'}
      <div class="h-full flex flex-col">
        <div class="px-3 py-1 bg-[#f9f9fb] dark:bg-[#181818] border-b border-[#e5e5e5] dark:border-[#2d2d2d] flex justify-end">
          <button
            onclick={copyBody}
            title="Copy Response Body"
            class="flex items-center gap-1 text-[11px] text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
          >
            {#if copied}
              <Check size={12} class="text-emerald-500" />
              <span class="text-emerald-600 dark:text-emerald-400 font-medium">Copied</span>
            {:else}
              <Copy size={12} />
              <span>Copy</span>
            {/if}
          </button>
        </div>
        <pre class="flex-1 p-3 m-0 font-mono text-[12px] leading-relaxed overflow-auto text-neutral-800 dark:text-neutral-200 select-text bg-white dark:bg-[#181818]">{responseState.bodyText || '// No response body'}</pre>
      </div>
    {:else if responseState.activeTab === 'headers'}
      <div class="h-full overflow-y-auto p-3">
        <table class="w-full text-left font-mono text-[11px]">
          <thead>
            <tr class="text-neutral-500 border-b border-[#e5e5e5] dark:border-[#333]">
              <th class="pb-1.5 font-semibold w-1/3">Header Name</th>
              <th class="pb-1.5 font-semibold">Value</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#e5e5e5] dark:divide-[#2a2a2a]">
            {#each responseState.headers as h}
              <tr class="hover:bg-[#f5f5f7] dark:hover:bg-[#252526]">
                <td class="py-1.5 text-blue-600 dark:text-blue-400 font-medium select-text">{h.key}</td>
                <td class="py-1.5 text-neutral-700 dark:text-neutral-300 select-text break-all">{h.value}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if responseState.headers.length === 0}
          <div class="text-center py-8 text-neutral-400 dark:text-neutral-500">No response headers</div>
        {/if}
      </div>
    {:else if responseState.activeTab === 'stream'}
      <StreamLog />
    {:else if responseState.activeTab === 'tests'}
      <div class="h-full flex flex-col p-4 overflow-y-auto space-y-4">
        {#if responseState.testResults.length === 0}
          <div class="text-center py-10 text-neutral-400 dark:text-neutral-500 text-xs">
            No test assertions executed yet.<br />
            <span class="text-[11px] text-neutral-400">Add assertions in the <strong>Scripts &gt; Post-response</strong> tab and send again.</span>
          </div>
        {:else}
          {@const allPassed = responseState.testResults.every((t) => t.passed)}
          {@const passCount = responseState.testResults.filter((t) => t.passed).length}
          <div class="p-2.5 rounded-md border flex items-center justify-between text-xs {allPassed ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-300'}">
            <span class="font-semibold">
              {allPassed ? 'All Tests Passed' : `${responseState.testResults.length - passCount} Test(s) Failed`}
            </span>
            <span class="font-mono font-bold">{passCount} / {responseState.testResults.length} PASS</span>
          </div>

          <div class="space-y-2">
            {#each responseState.testResults as test}
              <div class="p-2.5 rounded border border-neutral-200 dark:border-[#2d2d2d] bg-[#f9f9fb] dark:bg-[#1f1f1f] text-xs">
                <div class="flex items-center gap-2">
                  {#if test.passed}
                    <span class="text-emerald-500 font-bold text-sm leading-none">✓</span>
                    <span class="font-medium text-neutral-800 dark:text-neutral-200">{test.name}</span>
                    <span class="ml-auto text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-bold">PASS</span>
                  {:else}
                    <span class="text-rose-500 font-bold text-sm leading-none">✗</span>
                    <span class="font-medium text-neutral-800 dark:text-neutral-200">{test.name}</span>
                    <span class="ml-auto text-[10px] text-rose-600 dark:text-rose-400 font-mono font-bold">FAIL</span>
                  {/if}
                </div>
                {#if test.error}
                  <div class="mt-2 p-2 bg-rose-500/10 border border-rose-500/20 rounded font-mono text-[11px] text-rose-600 dark:text-rose-300">
                    {test.error}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if responseState.scriptLogs.length > 0}
          <div class="pt-3 border-t border-neutral-200 dark:border-[#2d2d2d]">
            <div class="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-2">
              Console Output
            </div>
            <div class="bg-[#181818] text-neutral-200 font-mono text-[11px] p-2.5 rounded space-y-1">
              {#each responseState.scriptLogs as log}
                <div class="break-all">{log}</div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {:else if responseState.activeTab === 'raw'}
      <pre class="h-full p-3 m-0 font-mono text-[12px] overflow-auto text-neutral-800 dark:text-neutral-300 select-text bg-white dark:bg-[#181818]">{responseState.bodyText || '// No response'}</pre>
    {/if}
  </div>
</div>
