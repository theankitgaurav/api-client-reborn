<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import type { WorkspaceFileItem } from '$lib/types';
  import {
    Folder,
    FolderOpen,
    FileCode,
    RefreshCw,
    Search,
    Plus,
  } from 'lucide-svelte';

  let searchQuery = $state('');

  function filterItems(items: WorkspaceFileItem[]): WorkspaceFileItem[] {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();

    return items
      .map((item) => {
        if (item.is_dir && item.children) {
          const matchingChildren = filterItems(item.children);
          if (matchingChildren.length > 0) {
            return { ...item, children: matchingChildren };
          }
        }
        const matchesName = item.name.toLowerCase().includes(query);
        const matchesDisplay = item.display_name?.toLowerCase().includes(query);
        if (matchesName || matchesDisplay) {
          return item;
        }
        return null;
      })
      .filter((item): item is WorkspaceFileItem => item !== null);
  }

  let filteredTree = $derived(filterItems(workspaceState.tree));

  function getBadgeClass(method?: string) {
    switch (method?.toUpperCase()) {
      case 'GET':
        return 'badge-get';
      case 'POST':
        return 'badge-post';
      case 'PUT':
        return 'badge-put';
      case 'DELETE':
        return 'badge-delete';
      case 'PATCH':
        return 'badge-patch';
      case 'GRPC':
        return 'badge-grpc';
      default:
        return 'bg-neutral-800 text-neutral-400 border border-neutral-700';
    }
  }
</script>

<aside class="w-64 bg-[#181818] border-r border-[#2d2d2d] flex flex-col h-full select-none text-xs">
  <!-- Search & Actions Bar -->
  <div class="p-2 border-b border-[#2d2d2d] flex items-center space-x-1.5">
    <div class="relative flex-1">
      <Search size={13} class="absolute left-2 top-2 text-neutral-500" />
      <input
        type="text"
        placeholder="Filter requests..."
        bind:value={searchQuery}
        class="w-full bg-[#202020] border border-[#303030] rounded pl-7 pr-2 py-1 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
      />
    </div>
    <button
      onclick={() => workspaceState.refreshTree()}
      title="Refresh Workspace"
      class="p-1 hover:bg-[#252526] rounded text-neutral-400 hover:text-neutral-200 transition-colors"
    >
      <RefreshCw size={14} class={workspaceState.isLoading ? 'animate-spin' : ''} />
    </button>
  </div>

  <!-- Workspace Collection Tree -->
  <div class="flex-1 overflow-y-auto p-1.5 space-y-0.5">
    {#each filteredTree as item}
      {#if item.is_dir}
        <div class="mb-1">
          <div class="flex items-center gap-1.5 px-2 py-1 text-neutral-400 font-semibold uppercase tracking-wider text-[10px]">
            <FolderOpen size={12} class="text-neutral-400" />
            <span>{item.name}</span>
          </div>
          {#if item.children}
            <div class="pl-2 space-y-0.5">
              {#each item.children as child}
                <button
                  onclick={() => workspaceState.openFile(child.path)}
                  class="w-full flex items-center justify-between px-2 py-1.5 rounded transition-colors text-left {workspaceState.activeFilePath === child.path
                    ? 'bg-[#2a2d2e] text-white'
                    : 'text-neutral-300 hover:bg-[#202020]'}"
                >
                  <div class="flex items-center gap-2 truncate">
                    <span
                      class="text-[9px] font-mono font-bold px-1 py-0.5 rounded leading-none {getBadgeClass(child.method)}"
                    >
                      {child.method || 'REQ'}
                    </span>
                    <span class="truncate">{child.display_name || child.name}</span>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <button
          onclick={() => workspaceState.openFile(item.path)}
          class="w-full flex items-center justify-between px-2 py-1.5 rounded transition-colors text-left {workspaceState.activeFilePath === item.path
            ? 'bg-[#2a2d2e] text-white'
            : 'text-neutral-300 hover:bg-[#202020]'}"
        >
          <div class="flex items-center gap-2 truncate">
            <span
              class="text-[9px] font-mono font-bold px-1 py-0.5 rounded leading-none {getBadgeClass(item.method)}"
            >
              {item.method || 'REQ'}
            </span>
            <span class="truncate">{item.display_name || item.name}</span>
          </div>
        </button>
      {/if}
    {/each}

    {#if filteredTree.length === 0}
      <div class="text-center py-6 text-neutral-500 text-xs">
        No request files found
      </div>
    {/if}
  </div>
</aside>
