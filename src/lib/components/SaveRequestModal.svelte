<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { X, Save, Folder } from '$lib/components/icons';
  import type { WorkspaceFileItem } from '$lib/types';

  let requestName = $state('');
  let selectedFolder = $state('examples');
  let customFileName = $state('');

  function getFolderList(items: WorkspaceFileItem[], parent = ''): { path: string; label: string }[] {
    const list: { path: string; label: string }[] = [];
    for (const item of items) {
      if (item.is_dir) {
        const display = parent ? `${parent}/${item.name}` : item.name;
        list.push({ path: item.name, label: `${display}/` });
        if (item.children) {
          list.push(...getFolderList(item.children, display));
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
      selectedFolder = workspaceState.targetNewRequestFolder || 'examples';
      customFileName = requestName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      if (!customFileName) customFileName = 'new_request';
      if (!customFileName.endsWith('.curl')) customFileName += '.curl';
    }
  });

  function handleNameInput(name: string) {
    requestName = name;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    customFileName = `${slug || 'request'}.curl`;
  }

  async function handleSave() {
    if (!requestName.trim()) return;
    let fileName = customFileName.trim();
    if (!fileName.endsWith('.curl')) fileName += '.curl';

    const fullPath = selectedFolder === '.' ? fileName : `${selectedFolder}/${fileName}`;
    await workspaceState.saveActiveFileAs(fullPath, requestName.trim());
  }
</script>

{#if workspaceState.isSaveModalOpen}
  <div class="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white dark:bg-[#202020] border border-neutral-200 dark:border-[#333] rounded-lg shadow-2xl w-full max-w-md overflow-hidden flex flex-col text-xs">
      <!-- Modal Header -->
      <div class="px-4 py-3 bg-[#f9f9fb] dark:bg-[#252526] border-b border-neutral-200 dark:border-[#333] flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Save size={15} class="text-blue-500" />
          <h2 class="font-semibold text-neutral-800 dark:text-neutral-200 text-sm">Save Request</h2>
        </div>
        <button
          onclick={() => (workspaceState.isSaveModalOpen = false)}
          class="text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <!-- Modal Body -->
      <div class="p-4 space-y-3.5 bg-white dark:bg-[#202020]">
        <div>
          <label for="save-req-name" class="block text-neutral-600 dark:text-neutral-400 font-medium mb-1">
            Request Name
          </label>
          <input
            id="save-req-name"
            type="text"
            bind:value={requestName}
            oninput={(e) => handleNameInput((e.target as HTMLInputElement).value)}
            placeholder="e.g. Get User Profile"
            class="w-full bg-neutral-50 dark:bg-[#181818] border border-neutral-300 dark:border-[#333] rounded px-2.5 py-1.5 text-xs text-neutral-800 dark:text-neutral-200 outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label for="save-folder-select" class="block text-neutral-600 dark:text-neutral-400 font-medium mb-1">
            Folder / Collection
          </label>
          <div class="relative">
            <select
              id="save-folder-select"
              bind:value={selectedFolder}
              class="w-full bg-neutral-50 dark:bg-[#181818] border border-neutral-300 dark:border-[#333] rounded px-2.5 py-1.5 text-xs text-neutral-800 dark:text-neutral-200 outline-none cursor-pointer"
            >
              {#each folderOptions as opt}
                <option value={opt.path}>{opt.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <div>
          <label for="save-file-name" class="block text-neutral-600 dark:text-neutral-400 font-medium mb-1">
            File Name
          </label>
          <div class="flex items-center gap-1 font-mono text-[11px] text-neutral-500 bg-neutral-100 dark:bg-[#181818] border border-neutral-300 dark:border-[#333] rounded px-2.5 py-1.5">
            <span>{selectedFolder === '.' ? '' : `${selectedFolder}/`}</span>
            <input
              id="save-file-name"
              type="text"
              bind:value={customFileName}
              class="flex-1 bg-transparent text-neutral-800 dark:text-neutral-200 outline-none font-mono"
            />
          </div>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="px-4 py-3 bg-[#f9f9fb] dark:bg-[#252526] border-t border-neutral-200 dark:border-[#333] flex justify-end gap-2">
        <button
          onclick={() => (workspaceState.isSaveModalOpen = false)}
          class="px-3 py-1.5 rounded text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
        >
          Cancel
        </button>
        <button
          onclick={handleSave}
          class="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium shadow"
        >
          Save Request
        </button>
      </div>
    </div>
  </div>
{/if}
