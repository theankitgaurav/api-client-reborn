<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { Save } from '$lib/components/icons';
  import Modal from '$lib/components/ui/Modal.svelte';
  import type { WorkspaceFileItem } from '$lib/types';

  let requestName = $state('');
  let selectedFolder = $state('.');
  let customFileName = $state('');

  function getFolderList(items: WorkspaceFileItem[], parent = ''): { path: string; label: string }[] {
    const list: { path: string; label: string }[] = [];
    for (const item of items) {
      if (item.is_dir) {
        const fullRelPath = parent ? `${parent}/${item.name}` : item.name;
        list.push({ path: fullRelPath, label: `${fullRelPath}/` });
        if (item.children) {
          list.push(...getFolderList(item.children, fullRelPath));
        }
      }
    }
    return list;
  }

  let folderOptions = $derived([
    { path: '.', label: 'Workspace Root (/)' },
    ...getFolderList(workspaceState.tree),
  ]);

  $effect(() => {
    if (workspaceState.isSaveModalOpen) {
      requestName = workspaceState.activeTab?.name || 'New Request';
      selectedFolder = workspaceState.targetNewRequestFolder || '.';
      const extension = workspaceState.activeTab?.requestType === 'grpc' ? '.grpcurl' : '.curl';
      customFileName = requestName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      if (!customFileName) customFileName = 'new_request';
      if (!customFileName.toLowerCase().endsWith(extension)) customFileName += extension;
    }
  });

  function handleNameInput(name: string) {
    requestName = name;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const extension = workspaceState.activeTab?.requestType === 'grpc' ? 'grpcurl' : 'curl';
    customFileName = `${slug || 'request'}.${extension}`;
  }

  async function handleSave() {
    if (!requestName.trim()) return;
    let fileName = customFileName.trim();
    const isGrpc = workspaceState.activeTab?.requestType === 'grpc';
    const isExistingGrpcExt = fileName.toLowerCase().endsWith('.grpcurl') || fileName.toLowerCase().endsWith('.grpc');
    const extension = isGrpc ? '.grpcurl' : '.curl';
    if (isGrpc) {
      if (!isExistingGrpcExt) fileName += extension;
    } else if (!fileName.toLowerCase().endsWith(extension)) {
      fileName += extension;
    }

    const fullPath = selectedFolder === '.' ? fileName : `${selectedFolder}/${fileName}`;
    await workspaceState.saveActiveFileAs(fullPath, requestName.trim());
  }
</script>

<Modal
  isOpen={workspaceState.isSaveModalOpen}
  title="Save {workspaceState.activeTab?.requestType === 'grpc' ? 'gRPC' : 'HTTP'} Request"
  maxWidth="md"
  onclose={() => (workspaceState.isSaveModalOpen = false)}
>
  {#snippet icon()}
    <Save size={14} class="text-[var(--accent)]" />
  {/snippet}

  <form
    onsubmit={(e) => {
      e.preventDefault();
      void handleSave();
    }}
    class="p-4 space-y-3.5 text-xs"
  >
    <div>
      <label for="save-req-name" class="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
        Request Name
      </label>
      <input
        id="save-req-name"
        type="text"
        bind:value={requestName}
        oninput={(e) => handleNameInput((e.target as HTMLInputElement).value)}
        placeholder="e.g. Get User Profile"
        class="w-full bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2.5 py-1.5 text-xs text-[var(--text-strong)] outline-none transition-colors"
      />
    </div>

    <div>
      <label for="save-folder-select" class="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
        Folder / Collection
      </label>
      <select
        id="save-folder-select"
        bind:value={selectedFolder}
        class="ui-select w-full px-2.5 py-1.5 text-xs cursor-pointer"
      >
        {#each folderOptions as opt}
          <option value={opt.path}>{opt.label}</option>
        {/each}
      </select>
    </div>

    <div>
      <label for="save-file-name" class="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
        File Name
      </label>
      <input
        id="save-file-name"
        type="text"
        bind:value={customFileName}
        placeholder="request.curl"
        class="w-full bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2.5 py-1.5 font-mono text-xs text-[var(--text-strong)] outline-none transition-colors"
      />
      <p class="text-[10px] text-[var(--text-subtle)] mt-1 font-mono">
        Will be saved to: {selectedFolder === '.' ? '' : `${selectedFolder}/`}{customFileName}
      </p>
    </div>
  </form>

  {#snippet footer()}
    <button
      type="button"
      onclick={() => (workspaceState.isSaveModalOpen = false)}
      class="ui-button ui-button-secondary h-7 px-3 text-[11px]"
    >
      Cancel
    </button>
    <button
      type="button"
      onclick={handleSave}
      disabled={!requestName.trim()}
      class="ui-button ui-button-primary h-7 px-3 text-[11px] disabled:opacity-40"
    >
      Save Request
    </button>
  {/snippet}
</Modal>
