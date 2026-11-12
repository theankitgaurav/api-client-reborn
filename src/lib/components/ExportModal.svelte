<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { readRequestFile } from '$lib/ipc';
  import { getCollectionArchivePath } from '$lib/utils/collection-exporter';
  import { createRequestArchive, type RequestArchiveFile } from '$lib/utils/request-archive';
  import { X, Download, Folder, HardDrive } from '$lib/components/icons';
  import type { WorkspaceFileItem } from '$lib/types';

  let archiveFiles = $state<RequestArchiveFile[]>([]);
  let archiveOutput = $state<Uint8Array | null>(null);
  let exportError = $state('');
  let isGenerating = $state(false);

  let targetFolder = $derived(workspaceState.exportTargetFolder);
  let collectionTitle = $derived(targetFolder?.display_name || targetFolder?.name || 'Workspace Collection');

  $effect(() => {
    if (workspaceState.isExportModalOpen) {
      generateArchive();
    }
  });

  async function collectFiles(item: WorkspaceFileItem, rootPath: string): Promise<RequestArchiveFile[]> {
    const list: RequestArchiveFile[] = [];
    if (item.is_dir && item.children) {
      for (const child of item.children) {
        list.push(...(await collectFiles(child, rootPath)));
      }
    } else if (!item.is_dir && /\.(?:curl|grpcurl|grpc)$/i.test(item.path)) {
      const details = await readRequestFile(item.path);
      list.push({
        path: getCollectionArchivePath(item.path, rootPath),
        content: details.raw_content,
      });
    }
    return list;
  }

  async function generateArchive() {
    isGenerating = true;
    exportError = '';
    archiveOutput = null;
    archiveFiles = [];
    try {
      const files: RequestArchiveFile[] = [];
      if (targetFolder) {
        files.push(...(await collectFiles(targetFolder, targetFolder.path)));
      } else {
        for (const rootItem of workspaceState.tree) {
          files.push(...(await collectFiles(rootItem, workspaceState.workspacePath)));
        }
      }
      archiveFiles = files;
      if (files.length > 0) archiveOutput = createRequestArchive(files);
    } catch (e) {
      console.error('Failed to generate request archive:', e);
      exportError = e instanceof Error ? e.message : String(e);
    } finally {
      isGenerating = false;
    }
  }

  function handleDownload() {
    if (!archiveOutput) return;
    const blob = new Blob([archiveOutput as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = collectionTitle.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'collection';
    a.download = `${slug}.zip`;
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
          <HardDrive size={16} class="text-blue-500" />
          <h2 class="font-semibold text-neutral-800 dark:text-neutral-200 text-sm">
            Export Request Files (.zip)
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
            {archiveFiles.length} {archiveFiles.length === 1 ? 'file' : 'files'}
          </span>
        </div>
      </div>

      <div class="p-4 flex-1 overflow-y-auto bg-white dark:bg-[#202020] min-h-[220px]">
        <p class="mb-3 text-[11px] text-neutral-500 dark:text-neutral-400">
          The ZIP contains the saved .curl, .grpcurl and .grpc files with their relative folders and exact on-disk contents.
        </p>
        <div class="rounded border border-neutral-200 dark:border-[#333] divide-y divide-neutral-200 dark:divide-[#2a2a2a] max-h-[320px] overflow-y-auto">
          {#if isGenerating}
            <div class="p-4 text-center text-neutral-400">Preparing archive...</div>
          {:else if exportError}
            <div class="p-4 text-rose-500">{exportError}</div>
          {:else if archiveFiles.length === 0}
            <div class="p-4 text-center text-neutral-400">No request files found to export.</div>
          {:else}
            {#each archiveFiles as file}
              <div class="px-3 py-2 flex items-center gap-2 font-mono text-[11px] text-neutral-700 dark:text-neutral-300">
                <Folder size={12} class="text-blue-500 shrink-0" />
                <span class="truncate">{file.path}</span>
              </div>
            {/each}
          {/if}
        </div>
      </div>

      <!-- Footer Actions -->
      <div class="px-4 py-3 bg-[#f9f9fb] dark:bg-[#252526] border-t border-neutral-200 dark:border-[#333] flex items-center justify-end">
        <div class="flex items-center gap-2">
          <button
            onclick={() => (workspaceState.isExportModalOpen = false)}
            class="px-3 py-1.5 rounded border border-neutral-300 dark:border-[#383838] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-[#303030] transition-colors"
          >
            Close
          </button>
          <button
            onclick={handleDownload}
            disabled={!archiveOutput || isGenerating}
            class="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3.5 py-1.5 rounded font-medium transition-colors shadow-sm active:scale-95"
          >
            <Download size={13} />
            <span>Download ZIP</span>
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
