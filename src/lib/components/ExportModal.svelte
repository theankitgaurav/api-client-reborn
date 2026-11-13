<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { readRequestFile } from '$lib/ipc';
  import { COLLECTION_EXPORT_LABEL, getCollectionArchivePath } from '$lib/utils/collection-exporter';
  import { saveArchiveWithDialog } from '$lib/utils/archive-save';
  import { createRequestArchive, type RequestArchiveFile } from '$lib/utils/request-archive';
  import { Download, Folder, HardDrive } from '$lib/components/icons';
  import Modal from '$lib/components/ui/Modal.svelte';
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

  async function handleDownload() {
    if (!archiveOutput) return;
    const slug = collectionTitle.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'collection';
    const filename = `${slug}.zip`;

    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        await saveArchiveWithDialog(
          archiveOutput,
          filename,
          (defaultPath) =>
            save({
              defaultPath,
              filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
            }),
          async (path, contents) => {
            const { writeFile } = await import('@tauri-apps/plugin-fs');
            await writeFile(path, contents);
          }
        );
      } else {
        const blob = new Blob([archiveOutput as BlobPart], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      exportError = '';
    } catch (error) {
      exportError = `Could not save ZIP: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
</script>

<Modal
  isOpen={workspaceState.isExportModalOpen}
  title={COLLECTION_EXPORT_LABEL}
  description={collectionTitle}
  maxWidth="2xl"
  onclose={() => (workspaceState.isExportModalOpen = false)}
>
  {#snippet icon()}
    <HardDrive size={15} />
  {/snippet}

  {#snippet headerActions()}
    <span class="ui-badge ui-badge-neutral">
      {archiveFiles.length} {archiveFiles.length === 1 ? 'file' : 'files'}
    </span>
  {/snippet}

  {#snippet children()}
    <div class="p-4 space-y-3 text-xs">
      <p class="text-[11px] text-[var(--text-muted)]">
        The ZIP contains the saved .curl, .grpcurl and .grpc files with their relative folders and exact on-disk contents.
      </p>
      <div class="rounded border border-[var(--border)] divide-y divide-[var(--border-subtle)] max-h-[320px] overflow-y-auto">
        {#if isGenerating}
          <div class="p-4 text-center text-[var(--text-muted)]">Preparing archive...</div>
        {:else if exportError}
          <div class="p-4 text-[var(--danger)]">{exportError}</div>
        {:else if archiveFiles.length === 0}
          <div class="p-4 text-center text-[var(--text-muted)]">No request files found to export.</div>
        {:else}
          {#each archiveFiles as file}
            <div class="px-3 py-2 flex items-center gap-2 font-mono text-[11px] text-[var(--text)]">
              <Folder size={12} class="text-[var(--accent)] shrink-0" />
              <span class="truncate">{file.path}</span>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/snippet}

  {#snippet footer()}
    <button
      onclick={() => (workspaceState.isExportModalOpen = false)}
      class="ui-button ui-button-secondary px-3 py-1.5"
    >
      Close
    </button>
    <button
      onclick={handleDownload}
      disabled={!archiveOutput || isGenerating}
      class="ui-button ui-button-primary px-3.5 py-1.5"
    >
      <Download size={13} />
      <span>Download ZIP</span>
    </button>
  {/snippet}
</Modal>
