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
    Download,
  } from '$lib/components/icons';

  let copied = $state(false);

  function downloadFilename() {
    const disposition = responseState.headers.find((header) => header.key.toLowerCase() === 'content-disposition')?.value || '';
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encodedName) {
      try {
        return safeFilename(decodeURIComponent(encodedName.trim().replace(/^"|"$/g, '')));
      } catch { /* use plain filename */ }
    }
    const plainName = disposition.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
    return safeFilename(plainName?.[1] || plainName?.[2] || 'download');
  }

  function safeFilename(value: string) {
    const basename = value.trim().split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, '');
    return basename || 'download';
  }

  function responseIsFile() {
    const disposition = responseState.headers.find((header) => header.key.toLowerCase() === 'content-disposition')?.value || '';
    if (/attachment/i.test(disposition) || /filename\s*\*?=/i.test(disposition)) return true;
    const contentType = responseState.headers.find((header) => header.key.toLowerCase() === 'content-type')?.value.toLowerCase() || '';
    if (!contentType) return false;
    return !(/^(text\/|application\/(json|[^;]*xml|javascript|x-www-form-urlencoded)|image\/svg\+xml)/i.test(contentType));
  }

  async function saveResponseFile() {
    const filename = downloadFilename();
    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const path = await save({ defaultPath: filename });
        if (path) await responseState.exportStream(path);
      } else {
        await responseState.exportStream(filename);
      }
    } catch (error) {
      alert(`Could not save response file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
    if (!status) return 'bg-[var(--surface-hover)] text-[var(--text-muted)] border border-[var(--border)]';
    if (status >= 200 && status < 300) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25';
    if (status >= 300 && status < 400) return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25';
    if (status >= 400 && status < 500) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25';
    return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/25';
  }

  function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
</script>

<div class="contents text-xs">
  <!-- Response Top Metric Bar -->
  <div class="col-start-3 row-start-2 flex min-w-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
    <div class="flex min-w-0 shrink items-center gap-2 overflow-hidden whitespace-nowrap">
      {#if responseState.status}
        <span class="px-2 py-0.5 rounded font-mono font-bold text-[11px] {getStatusBadge(responseState.status)}">
          {responseState.status} {responseState.statusText}
        </span>
      {:else if responseState.isExecuting}
        <span class="px-2 py-0.5 rounded font-mono text-[11px] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)] border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] animate-pulse font-medium">
          Sending…
        </span>
      {:else}
        <span class="truncate text-[11px] text-[var(--text-subtle)]" title="No response yet">No response yet</span>
      {/if}

      {#if responseState.isStreaming && responseState.isExecuting}
        <span class="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 animate-pulse">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
          Streaming live
        </span>
      {/if}

      {#if responseState.durationMs !== null}
        <span class="flex items-center gap-1 text-[var(--text-muted)] text-[11px] font-mono">
          <Clock size={11} class="text-[var(--text-subtle)]" />
          {responseState.durationMs}ms
        </span>
      {/if}

      {#if responseState.totalBytes > 0}
        <span class="flex items-center gap-1 text-[var(--text-muted)] text-[11px] font-mono">
          <HardDrive size={11} class="text-[var(--text-subtle)]" />
          {formatBytes(responseState.totalBytes)}
        </span>
      {/if}
    </div>

    <!-- Tab Selector -->
    <div class="flex min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto text-xs">
      <button
        onclick={() => (responseState.activeTab = 'body')}
        class="shrink-0 border-b-2 px-2.5 py-1.5 font-medium transition-colors {responseState.activeTab === 'body'
          ? 'border-[var(--accent)] text-[var(--text-strong)] font-semibold'
          : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]'}"
      >
        Body
      </button>
      <button
        onclick={() => (responseState.activeTab = 'headers')}
        class="shrink-0 border-b-2 px-2.5 py-1.5 font-medium transition-colors {responseState.activeTab === 'headers'
          ? 'border-[var(--accent)] text-[var(--text-strong)] font-semibold'
          : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]'}"
      >
        Headers ({responseState.headers.length})
      </button>
      {#if responseState.isStreaming}
        <button
          onclick={() => (responseState.activeTab = 'stream')}
          class="shrink-0 border-b-2 px-2.5 py-1.5 font-medium transition-colors {responseState.activeTab === 'stream'
            ? 'border-[var(--accent)] text-[var(--text-strong)] font-semibold'
            : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]'}"
        >
          Stream ({responseState.streamMessages.length})
        </button>
      {/if}
      <button
        onclick={() => (responseState.activeTab = 'tests')}
        class="flex shrink-0 items-center gap-1 border-b-2 px-2.5 py-1.5 font-medium transition-colors {responseState.activeTab === 'tests'
          ? 'border-[var(--accent)] text-[var(--text-strong)] font-semibold'
          : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]'}"
      >
        <span>Tests</span>
        {#if responseState.testResults.length > 0}
          {@const allPassed = responseState.testResults.every((t) => t.passed)}
          {@const passCount = responseState.testResults.filter((t) => t.passed).length}
          <span
            class="px-1 py-0.2 rounded text-[9px] font-mono font-bold {allPassed
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}"
          >
            {passCount}/{responseState.testResults.length}
          </span>
        {/if}
      </button>
      <button
        onclick={() => (responseState.activeTab = 'raw')}
        class="shrink-0 border-b-2 px-2.5 py-1.5 font-medium transition-colors {responseState.activeTab === 'raw'
          ? 'border-[var(--accent)] text-[var(--text-strong)] font-semibold'
          : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]'}"
      >
        Raw
      </button>
    </div>
  </div>

  <div class="col-start-3 row-start-3 flex min-h-0 flex-col overflow-hidden bg-[var(--surface)]">
    <!-- Error Alert if present -->
    {#if responseState.error}
      <div class="flex items-start gap-2 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-3 text-[var(--danger)]">
        <AlertTriangle size={15} class="mt-0.5 shrink-0" />
        <div>
          <p class="text-xs font-semibold">Request Failed</p>
          <p class="mt-0.5 font-mono text-[11px] break-all">{responseState.error}</p>
        </div>
      </div>
    {/if}

    <!-- Tab Content -->
    <div class="relative min-h-0 flex-1 overflow-hidden bg-[var(--surface)]">
      {#if responseState.activeTab === 'body'}
        <div class="h-full flex flex-col">
        {#if responseState.isBodyTruncated || (responseState.isStreaming && responseState.spoolFilePath)}
          <div class="px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-[var(--warning)]">
            <span>
              {#if responseState.isBodyTruncated}
                ⚠️ Large response preview truncated at 2.0 MB (Total payload: <strong>{formatBytes(responseState.totalBytes)}</strong>).
              {:else}
                Full streaming response is saved to disk ({formatBytes(responseState.totalBytes)}).
              {/if}
            </span>
          </div>
        {/if}
        <div class="px-3 py-1 bg-[var(--surface-muted)] border-b border-[var(--border)] flex justify-end gap-2">
          {#if responseIsFile() && responseState.status && !responseState.isExecuting && responseState.spoolFilePath}
            <button
              onclick={saveResponseFile}
              title="Save response as file"
              class="ui-button ui-button-secondary h-6 px-2 text-[10px]"
            >
              <Download size={11} />
              <span>Save {downloadFilename()}</span>
            </button>
          {/if}
          <button
            onclick={copyBody}
            title="Copy Response Body"
            class="ui-button ui-button-secondary h-6 px-2 text-[10px]"
          >
            {#if copied}
              <Check size={11} class="text-[var(--success)]" />
              <span class="text-[var(--success)] font-medium">Copied</span>
            {:else}
              <Copy size={11} />
              <span>Copy</span>
            {/if}
          </button>
        </div>
        <pre class="flex-1 whitespace-pre-wrap break-words p-3 m-0 font-mono text-xs leading-relaxed overflow-auto text-[var(--text-strong)] select-text bg-[var(--surface)]">{responseState.bodyText || '// No response body'}</pre>
        </div>
      {:else if responseState.activeTab === 'headers'}
        <div class="h-full overflow-y-auto p-3">
        <table class="w-full text-left font-mono text-[11px]">
          <thead>
            <tr class="text-[var(--text-subtle)] border-b border-[var(--border)]">
              <th class="pb-1.5 font-semibold w-1/3">Header Name</th>
              <th class="pb-1.5 font-semibold">Value</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-subtle)]">
            {#each responseState.headers as h}
              <tr class="hover:bg-[var(--surface-hover)] transition-colors">
                <td class="py-1 text-[var(--accent)] font-medium select-text">{h.key}</td>
                <td class="py-1 text-[var(--text)] select-text break-all">{h.value}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if responseState.headers.length === 0}
          <div class="text-center py-8 text-[11px] text-[var(--text-subtle)]">No response headers</div>
        {/if}
        </div>
      {:else if responseState.activeTab === 'stream'}
        <StreamLog />
      {:else if responseState.activeTab === 'tests'}
        <div class="h-full flex flex-col p-4 overflow-y-auto space-y-3">
        {#if responseState.testResults.length === 0}
          <div class="text-center py-10 text-[var(--text-subtle)] text-xs">
            No test assertions executed yet.<br />
            <span class="text-[11px] text-[var(--text-muted)]">Add assertions in the <strong>Scripts &gt; Post-response</strong> tab and send again.</span>
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

          <div class="space-y-1.5">
            {#each responseState.testResults as test}
              <div class="p-2.5 rounded border border-[var(--border)] bg-[var(--surface-muted)] text-xs">
                <div class="flex items-center gap-2">
                  {#if test.passed}
                    <span class="text-[var(--success)] font-bold text-sm leading-none">✓</span>
                    <span class="font-medium text-[var(--text-strong)]">{test.name}</span>
                    <span class="ml-auto text-[10px] text-[var(--success)] font-mono font-bold">PASS</span>
                  {:else}
                    <span class="text-[var(--danger)] font-bold text-sm leading-none">✗</span>
                    <span class="font-medium text-[var(--text-strong)]">{test.name}</span>
                    <span class="ml-auto text-[10px] text-[var(--danger)] font-mono font-bold">FAIL</span>
                  {/if}
                </div>
                {#if test.error}
                  <div class="mt-1.5 p-2 bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_20%,transparent)] rounded font-mono text-[11px] text-[var(--danger)]">
                    {test.error}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if responseState.scriptLogs.length > 0}
          <div class="pt-3 border-t border-[var(--border)]">
            <div class="text-[10px] font-semibold text-[var(--text-subtle)] uppercase tracking-wider mb-1.5">
              Console Output
            </div>
            <div class="bg-[var(--surface-muted)] text-[var(--text-strong)] border border-[var(--border)] font-mono text-[11px] p-2.5 rounded space-y-1">
              {#each responseState.scriptLogs as log}
                <div class="break-all">{log}</div>
              {/each}
            </div>
          </div>
        {/if}
        </div>
      {:else if responseState.activeTab === 'raw'}
        <pre class="h-full whitespace-pre-wrap break-words p-3 m-0 font-mono text-xs overflow-auto text-[var(--text-strong)] select-text bg-[var(--surface)]">{responseState.bodyText || '// No response'}</pre>
      {/if}
    </div>
  </div>
</div>
