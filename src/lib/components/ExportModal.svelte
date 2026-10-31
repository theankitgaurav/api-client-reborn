<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { envState } from '$lib/state/env.svelte';
  import { readRequestFile } from '$lib/ipc';
  import {
    generateCollectionShellScript,
    type FlattenedRequest,
  } from '$lib/utils/collection-exporter';
  import { X, Download, Copy, Check, Terminal, Folder } from '$lib/components/icons';
  import type { WorkspaceFileItem } from '$lib/types';

  let includeVars = $state(true);
  let scriptOutput = $state('');
  let isGenerating = $state(false);
  let copied = $state(false);
  let requestCount = $state(0);

  let targetFolder = $derived(workspaceState.exportTargetFolder);
  let collectionTitle = $derived(targetFolder?.display_name || targetFolder?.name || 'Workspace Collection');

  // Load and generate the script when modal opens
  $effect(() => {
    if (workspaceState.isExportModalOpen) {
      generateScript();
    }
  });

  async function collectRequests(item: WorkspaceFileItem): Promise<FlattenedRequest[]> {
    const list: FlattenedRequest[] = [];

    if (item.is_dir && item.children) {
      for (const child of item.children) {
        list.push(...(await collectRequests(child)));
      }
    } else if (!item.is_dir) {
      let content = '';
      const openTab = workspaceState.tabs.find((t) => t.filePath === item.path);
      if (openTab) {
        content = openTab.rawContent;
      } else {
        try {
          const details = await readRequestFile(item.path);
          content = details.raw_content;
        } catch {
          content = `# @name ${item.name}\ncurl -X GET "https://httpbin.org/get"`;
        }
      }

      list.push({
        path: item.path,
        name: openTab?.name || item.display_name || item.name,
        method: openTab?.method || item.method || 'GET',
        command: content,
        ...(item.kind === 'grpc' || item.path.toLowerCase().endsWith('.grpc') ? { kind: 'grpc' as const } : {}),
      });
    }

    return list;
  }

  async function generateScript() {
    isGenerating = true;
    try {
      let requests: FlattenedRequest[] = [];

      if (targetFolder) {
        requests = await collectRequests(targetFolder);
      } else {
        // Collect all from entire workspace tree
        for (const rootItem of workspaceState.tree) {
          requests.push(...(await collectRequests(rootItem)));
        }
      }

      requestCount = requests.length;
      const vars = includeVars ? envState.mergedVariables : {};
      scriptOutput = generateCollectionShellScript(collectionTitle, requests, vars);
    } catch (e) {
      console.error('Failed to generate export script:', e);
      scriptOutput = `# Error generating script: ${e}`;
    } finally {
      isGenerating = false;
    }
  }

  function handleCopy() {
    if (!scriptOutput) return;
    navigator.clipboard.writeText(scriptOutput);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  }

  function handleDownload() {
    if (!scriptOutput) return;
    const slug = collectionTitle.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
    const blob = new Blob([scriptOutput], { type: 'application/x-sh;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `run_${slug || 'collection'}.sh`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
</script>

{#if workspaceState.isExportModalOpen}
  <div class="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white dark:bg-[#202020] border border-neutral-200 dark:border-[#333] rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col text-xs max-h-[85vh]">
      <!-- Header -->
      <div class="px-4 py-3 bg-[#f9f9fb] dark:bg-[#252526] border-b border-neutral-200 dark:border-[#333] flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Terminal size={16} class="text-emerald-500" />
          <h2 class="font-semibold text-neutral-800 dark:text-neutral-200 text-sm">
            Export Collection as Shell Script (.sh)
          </h2>
        </div>
        <button
          onclick={() => (workspaceState.isExportModalOpen = false)}
          class="text-neutral-500 hover:text-neutral-800 dark:hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <!-- Settings Bar -->
      <div class="px-4 py-2.5 bg-neutral-100 dark:bg-[#1a1a1a] border-b border-neutral-200 dark:border-[#333] flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Folder size={14} class="text-blue-500" />
          <span class="font-medium text-neutral-700 dark:text-neutral-300">
            {collectionTitle}
          </span>
          <span class="bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 px-1.5 py-0.2 rounded-full font-mono text-[10px]">
            {requestCount} {requestCount === 1 ? 'request' : 'requests'}
          </span>
        </div>

        <label class="flex items-center gap-1.5 cursor-pointer text-neutral-600 dark:text-neutral-400 select-none">
          <input
            type="checkbox"
            bind:checked={includeVars}
            onchange={generateScript}
            class="rounded border-neutral-300 dark:border-neutral-600 text-blue-600 focus:ring-0"
          />
          <span>Include Active Variables</span>
        </label>
      </div>

      <!-- Code Preview Area -->
      <div class="p-4 flex-1 overflow-hidden flex flex-col bg-white dark:bg-[#202020]">
        <div class="mb-2 text-[11px] text-neutral-500 dark:text-neutral-400 flex items-center justify-between">
          <span>Executable bash script for macOS, Linux, or WSL. gRPC requests require grpcurl:</span>
        </div>
        <div class="relative flex-1 rounded border border-neutral-300 dark:border-[#333] bg-neutral-900 overflow-hidden flex flex-col font-mono text-[11px] min-h-[260px]">
          {#if isGenerating}
            <div class="absolute inset-0 flex items-center justify-center text-neutral-400 bg-neutral-900/80">
              Generating runner script...
            </div>
          {/if}
          <textarea
            readonly
            value={scriptOutput}
            class="w-full h-full p-3 bg-transparent text-emerald-400 outline-none resize-none font-mono selection:bg-emerald-900"
          ></textarea>
        </div>
      </div>

      <!-- Footer Actions -->
      <div class="px-4 py-3 bg-[#f9f9fb] dark:bg-[#252526] border-t border-neutral-200 dark:border-[#333] flex items-center justify-between">
        <span class="text-[11px] text-neutral-400">
          Make executable: <code class="bg-neutral-200 dark:bg-neutral-800 px-1 py-0.5 rounded text-[10px]">chmod +x run.sh</code>
        </span>
        <div class="flex items-center gap-2">
          <button
            onclick={() => (workspaceState.isExportModalOpen = false)}
            class="px-3 py-1.5 rounded border border-neutral-300 dark:border-[#383838] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-[#303030] transition-colors"
          >
            Close
          </button>
          <button
            onclick={handleCopy}
            class="flex items-center gap-1.5 bg-neutral-200 dark:bg-[#303030] hover:bg-neutral-300 dark:hover:bg-[#383838] text-neutral-800 dark:text-neutral-200 px-3 py-1.5 rounded font-medium transition-colors"
          >
            {#if copied}
              <Check size={13} class="text-emerald-500" />
              <span>Copied!</span>
            {:else}
              <Copy size={13} />
              <span>Copy Script</span>
            {/if}
          </button>
          <button
            onclick={handleDownload}
            class="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-1.5 rounded font-medium transition-colors shadow-sm active:scale-95"
          >
            <Download size={13} />
            <span>Download .sh</span>
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
