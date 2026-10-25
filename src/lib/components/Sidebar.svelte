<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { envState } from '$lib/state/env.svelte';
  import { readRequestFile } from '$lib/ipc';
  import { getResolvedCommand } from '$lib/utils/curl-generator';
  import type { WorkspaceFileItem } from '$lib/types';
  import {
    FolderOpen,
    RefreshCw,
    Search,
    Terminal,
    Check,
  } from '$lib/components/icons';

  let searchQuery = $state('');
  let copiedPath = $state<string | null>(null);

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

  async function copyRequestCommand(item: WorkspaceFileItem) {
    try {
      let rawContent = '';
      if (workspaceState.activeFilePath === item.path && workspaceState.activeFile) {
        rawContent = workspaceState.activeFile.raw_content;
      } else {
        const details = await readRequestFile(item.path);
        rawContent = details.raw_content;
      }

      const resolved = getResolvedCommand(rawContent, envState.mergedVariables);
      navigator.clipboard.writeText(resolved);
      copiedPath = item.path;
      setTimeout(() => {
        copiedPath = null;
      }, 1500);
    } catch (e) {
      console.error('Failed to copy command:', e);
    }
  }
</script>

<aside class="w-64 bg-[#fbfbfd] dark:bg-[#181818] border-r border-[#d8d8dc] dark:border-[#2d2d2d] flex flex-col h-full select-none text-xs transition-colors">
  <!-- Search & Actions Bar -->
  <div class="p-2 border-b border-[#e5e5e5] dark:border-[#2d2d2d] flex items-center space-x-1.5">
    <div class="relative flex-1">
      <Search size={13} class="absolute left-2 top-2 text-neutral-400" />
      <input
        type="text"
        placeholder="Filter requests..."
        bind:value={searchQuery}
        class="w-full bg-white dark:bg-[#202020] border border-[#d2d2d7] dark:border-[#303030] rounded pl-7 pr-2 py-1 text-xs text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:border-blue-500 shadow-sm"
      />
    </div>
    <button
      onclick={() => workspaceState.refreshTree()}
      title="Refresh Workspace"
      class="p-1 hover:bg-neutral-200/60 dark:hover:bg-[#252526] rounded text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
    >
      <RefreshCw size={14} class={workspaceState.isLoading ? 'animate-spin' : ''} />
    </button>
  </div>

  <!-- Workspace Collection Tree -->
  <div class="flex-1 overflow-y-auto p-1.5 space-y-0.5">
    {#each filteredTree as item}
      {#if item.is_dir}
        <div class="mb-1">
          <div class="flex items-center gap-1.5 px-2 py-1 text-neutral-500 dark:text-neutral-400 font-semibold uppercase tracking-wider text-[10px]">
            <FolderOpen size={12} class="text-neutral-400" />
            <span>{item.name}</span>
          </div>
          {#if item.children}
            <div class="pl-2 space-y-0.5">
              {#each item.children as child}
                <div
                  role="button"
                  tabindex="0"
                  onclick={() => workspaceState.openFile(child.path)}
                  onkeydown={(e) => e.key === 'Enter' && workspaceState.openFile(child.path)}
                  class="group w-full flex items-center justify-between px-2 py-1.5 rounded transition-all cursor-pointer text-left {workspaceState.activeFilePath === child.path
                    ? 'bg-white dark:bg-[#2a2d2e] text-blue-600 dark:text-white shadow-sm border border-[#e0e0e5] dark:border-transparent font-medium'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/50 dark:hover:bg-[#202020]'}"
                >
                  <div class="flex items-center gap-2 truncate flex-1 mr-1">
                    <span
                      class="text-[9px] font-mono font-bold px-1 py-0.5 rounded leading-none {getBadgeClass(child.method)}"
                    >
                      {child.method || 'REQ'}
                    </span>
                    <span class="truncate">{child.display_name || child.name}</span>
                  </div>

                  <!-- Quick Copy Button on Hover -->
                  <button
                    type="button"
                    onclick={(e) => {
                      e.stopPropagation();
                      copyRequestCommand(child);
                    }}
                    title="Copy resolved {child.path.endsWith('.grpcurl') ? 'grpcurl' : 'cURL'} command"
                    class="opacity-0 group-hover:opacity-100 p-0.5 hover:text-neutral-900 dark:hover:text-white text-neutral-400 rounded transition-opacity"
                  >
                    {#if copiedPath === child.path}
                      <Check size={12} class="text-emerald-500" />
                    {:else}
                      <Terminal size={12} />
                    {/if}
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <div
          role="button"
          tabindex="0"
          onclick={() => workspaceState.openFile(item.path)}
          onkeydown={(e) => e.key === 'Enter' && workspaceState.openFile(item.path)}
          class="group w-full flex items-center justify-between px-2 py-1.5 rounded transition-all cursor-pointer text-left {workspaceState.activeFilePath === item.path
            ? 'bg-white dark:bg-[#2a2d2e] text-blue-600 dark:text-white shadow-sm border border-[#e0e0e5] dark:border-transparent font-medium'
            : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/50 dark:hover:bg-[#202020]'}"
        >
          <div class="flex items-center gap-2 truncate flex-1 mr-1">
            <span
              class="text-[9px] font-mono font-bold px-1 py-0.5 rounded leading-none {getBadgeClass(item.method)}"
            >
              {item.method || 'REQ'}
            </span>
            <span class="truncate">{item.display_name || item.name}</span>
          </div>

          <!-- Quick Copy Button on Hover -->
          <button
            type="button"
            onclick={(e) => {
              e.stopPropagation();
              copyRequestCommand(item);
            }}
            title="Copy resolved {item.path.endsWith('.grpcurl') ? 'grpcurl' : 'cURL'} command"
            class="opacity-0 group-hover:opacity-100 p-0.5 hover:text-neutral-900 dark:hover:text-white text-neutral-400 rounded transition-opacity"
          >
            {#if copiedPath === item.path}
              <Check size={12} class="text-emerald-500" />
            {:else}
              <Terminal size={12} />
            {/if}
          </button>
        </div>
      {/if}
    {/each}

    {#if filteredTree.length === 0}
      <div class="text-center py-6 text-neutral-400 dark:text-neutral-500 text-xs">
        No request files found
      </div>
    {/if}
  </div>
</aside>
