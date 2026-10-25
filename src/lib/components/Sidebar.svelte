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
    Plus,
    Upload,
    FolderPlus,
    Copy,
    Trash2,
    MoreVertical,
  } from '$lib/components/icons';

  let searchQuery = $state('');

  let itemContextMenu = $state<{
    visible: boolean;
    x: number;
    y: number;
    item: WorkspaceFileItem;
  } | null>(null);

  function countRequests(items: WorkspaceFileItem[]): number {
    let count = 0;
    for (const item of items) {
      if (!item.is_dir) count++;
      if (item.children) count += countRequests(item.children);
    }
    return count;
  }

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
    } catch (e) {
      console.error('Failed to copy command:', e);
    }
  }

  function handleItemContextMenu(e: MouseEvent, item: WorkspaceFileItem) {
    e.preventDefault();
    e.stopPropagation();
    itemContextMenu = {
      visible: true,
      x: e.clientX,
      y: e.clientY,
      item,
    };
  }

  function toggleContextMenuForElement(e: MouseEvent, item: WorkspaceFileItem) {
    e.preventDefault();
    e.stopPropagation();

    if (itemContextMenu?.visible && itemContextMenu.item.path === item.path) {
      itemContextMenu = null;
      return;
    }

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const menuWidth = 192; // w-48 = 12rem
    const menuHeight = item.is_dir ? 190 : 230;

    let x = rect.right - menuWidth;
    if (x < 8) x = 8;
    if (x + menuWidth > window.innerWidth - 8) {
      x = Math.max(8, window.innerWidth - menuWidth - 8);
    }

    let y = rect.bottom + 4;
    if (y + menuHeight > window.innerHeight - 8) {
      y = Math.max(8, rect.top - menuHeight - 4);
    }

    itemContextMenu = {
      visible: true,
      x,
      y,
      item,
    };
  }

  function closeContextMenu() {
    itemContextMenu = null;
  }

  function handleCreateFolder() {
    const name = prompt('Enter new collection / folder name:');
    if (name && name.trim()) {
      workspaceState.createFolder('.', name.trim());
    }
  }
</script>

<svelte:window onclick={closeContextMenu} />

<aside class="w-64 bg-[#fbfbfd] dark:bg-[#181818] border-r border-[#d8d8dc] dark:border-[#2d2d2d] flex flex-col h-full select-none text-xs transition-colors">
  <!-- Requests Header & Actions -->
  <div class="px-3 py-2 border-b border-[#e5e5e5] dark:border-[#2d2d2d] flex items-center justify-between">
    <div class="flex items-center gap-1.5" title="Storage directory: {workspaceState.workspacePath}">
      <span class="font-semibold text-neutral-800 dark:text-neutral-200 text-xs">Requests</span>
      <span class="text-[10px] bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 px-1.5 py-0.2 rounded-full font-mono">
        {countRequests(workspaceState.tree)}
      </span>
    </div>
    <div class="flex items-center gap-1">
      <button
        onclick={() => workspaceState.createNewRequest()}
        title="Create New Request"
        class="flex items-center gap-0.5 bg-blue-600 hover:bg-blue-500 text-white px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors shadow-sm active:scale-95"
      >
        <Plus size={11} />
        <span>New</span>
      </button>

      <button
        onclick={handleCreateFolder}
        title="New Folder / Collection"
        class="p-1 hover:bg-neutral-200/60 dark:hover:bg-[#252526] rounded text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
      >
        <FolderPlus size={13} />
      </button>

      <button
        onclick={() => workspaceState.openImportModal()}
        title="Import Collection or cURL"
        class="p-1 hover:bg-neutral-200/60 dark:hover:bg-[#252526] rounded text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
      >
        <Upload size={13} />
      </button>

      <button
        onclick={() => workspaceState.refreshTree()}
        title="Refresh Workspace"
        class="p-1 hover:bg-neutral-200/60 dark:hover:bg-[#252526] rounded text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
      >
        <RefreshCw size={13} class={workspaceState.isLoading ? 'animate-spin' : ''} />
      </button>
    </div>
  </div>

  <!-- Filter Input -->
  <div class="p-2 border-b border-[#e5e5e5] dark:border-[#2d2d2d]">
    <div class="relative w-full">
      <Search size={13} class="absolute left-2 top-2 text-neutral-400" />
      <input
        type="text"
        placeholder="Filter requests..."
        bind:value={searchQuery}
        class="w-full bg-white dark:bg-[#202020] border border-[#d2d2d7] dark:border-[#303030] rounded pl-7 pr-2 py-1 text-xs text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:border-blue-500 shadow-sm"
      />
    </div>
  </div>

  <!-- Workspace Collection Tree -->
  <div class="flex-1 overflow-y-auto p-1.5 space-y-0.5">
    {#snippet renderNode(item: WorkspaceFileItem, depth: number)}
      {#if item.is_dir}
        <div class="mb-1" style="padding-left: {depth * 6}px;">
          <div
            role="button"
            tabindex="0"
            oncontextmenu={(e) => handleItemContextMenu(e, item)}
            class="group flex items-center justify-between px-2 py-1 text-neutral-500 dark:text-neutral-400 font-semibold uppercase tracking-wider text-[10px] hover:bg-neutral-200/50 dark:hover:bg-[#202020] rounded cursor-pointer"
          >
            <div class="flex items-center gap-1.5 truncate flex-1">
              <FolderOpen size={12} class="text-neutral-400 shrink-0" />
              <span class="truncate">{item.name}</span>
            </div>
            <div class="flex items-center gap-0.5 transition-opacity {itemContextMenu?.visible && itemContextMenu.item.path === item.path ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}">
              <button
                type="button"
                onclick={(e) => {
                  e.stopPropagation();
                  workspaceState.createNewRequestInFolder(item.name);
                }}
                title="New Request in this folder"
                class="p-0.5 hover:text-neutral-900 dark:hover:text-white text-neutral-400 rounded"
              >
                <Plus size={11} />
              </button>
              <button
                type="button"
                onclick={(e) => toggleContextMenuForElement(e, item)}
                title="Folder options"
                class="p-0.5 hover:text-neutral-900 dark:hover:text-white text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 rounded"
              >
                <MoreVertical size={11} />
              </button>
            </div>
          </div>
          {#if item.children && item.children.length > 0}
            <div class="space-y-0.5">
              {#each item.children as child}
                {@render renderNode(child, depth + 1)}
              {/each}
            </div>
          {:else}
            <div class="pl-4 py-1 text-[10px] text-neutral-400 dark:text-neutral-600 italic">
              Empty folder
            </div>
          {/if}
        </div>
      {:else}
        <div style="padding-left: {depth * 6}px;">
          <div
            role="button"
            tabindex="0"
            onclick={() => workspaceState.openRequest(item.path, false)}
            ondblclick={() => workspaceState.openRequest(item.path, true)}
            oncontextmenu={(e) => handleItemContextMenu(e, item)}
            onkeydown={(e) => e.key === 'Enter' && workspaceState.openRequest(item.path, false)}
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

            <!-- Three dot icon to invoke context menu -->
            <button
              type="button"
              onclick={(e) => toggleContextMenuForElement(e, item)}
              title="Request options"
              class="p-0.5 hover:text-neutral-900 dark:hover:text-white text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 rounded transition-opacity {itemContextMenu?.visible && itemContextMenu.item.path === item.path
                ? 'opacity-100 text-neutral-900 dark:text-white'
                : 'opacity-0 group-hover:opacity-100'}"
            >
              <MoreVertical size={12} />
            </button>
          </div>
        </div>
      {/if}
    {/snippet}

    {#each filteredTree as item}
      {@render renderNode(item, 0)}
    {/each}

    {#if filteredTree.length === 0}
      <div class="text-center py-6 text-neutral-400 dark:text-neutral-500 text-xs">
        No request files found
      </div>
    {/if}
  </div>
</aside>

<!-- Right-Click Context Menu -->
{#if itemContextMenu && itemContextMenu.visible}
  <div
    class="fixed z-50 bg-white dark:bg-[#252526] border border-neutral-200 dark:border-[#383838] rounded-md shadow-xl py-1 text-xs text-neutral-700 dark:text-neutral-200 w-48 select-none"
    style="left: {itemContextMenu.x}px; top: {itemContextMenu.y}px;"
  >
    {#if itemContextMenu.item.is_dir}
      <!-- Folder Context Menu -->
      <button
        class="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors flex items-center justify-between"
        onclick={() => {
          if (itemContextMenu) workspaceState.createNewRequestInFolder(itemContextMenu.item.name);
          closeContextMenu();
        }}
      >
        <span>New Request Here</span>
      </button>

      <button
        class="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors flex items-center justify-between"
        onclick={() => {
          if (itemContextMenu) {
            const sub = prompt('Enter subfolder name:');
            if (sub && sub.trim()) {
              workspaceState.createFolder(itemContextMenu.item.path, sub.trim());
            }
          }
          closeContextMenu();
        }}
      >
        <span>New Subfolder</span>
      </button>

      <div class="h-px bg-neutral-200 dark:bg-[#383838] my-1"></div>

      <button
        class="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors flex items-center justify-between"
        onclick={() => {
          if (itemContextMenu) workspaceState.openExportModal(itemContextMenu.item);
          closeContextMenu();
        }}
      >
        <span>Export Collection (.sh)</span>
      </button>

      <div class="h-px bg-neutral-200 dark:bg-[#383838] my-1"></div>

      <button
        class="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors"
        onclick={() => {
          if (itemContextMenu) {
            const item = itemContextMenu.item;
            closeContextMenu();
            workspaceState.renameItem(item.path, item.name);
          } else {
            closeContextMenu();
          }
        }}
      >
        Rename Folder
      </button>

      <button
        class="w-full text-left px-3 py-1.5 hover:bg-rose-600 hover:text-white text-rose-600 dark:text-rose-400 transition-colors"
        onclick={() => {
          if (itemContextMenu) {
            workspaceState.deleteItem(itemContextMenu.item.path, itemContextMenu.item.name);
          }
          closeContextMenu();
        }}
      >
        Delete Folder
      </button>
    {:else}
      <!-- Request Item Context Menu -->
      <button
        class="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors"
        onclick={() => {
          if (itemContextMenu) workspaceState.openRequest(itemContextMenu.item.path, true);
          closeContextMenu();
        }}
      >
        Open in New Tab
      </button>

      <button
        class="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors"
        onclick={() => {
          if (itemContextMenu) workspaceState.openRequest(itemContextMenu.item.path, false);
          closeContextMenu();
        }}
      >
        Open in Current Tab
      </button>

      <div class="h-px bg-neutral-200 dark:bg-[#383838] my-1"></div>

      <button
        class="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors"
        onclick={() => {
          if (itemContextMenu) copyRequestCommand(itemContextMenu.item);
          closeContextMenu();
        }}
      >
        Copy as cURL
      </button>

      <button
        class="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors"
        onclick={() => {
          if (itemContextMenu) workspaceState.duplicateRequest(itemContextMenu.item.path);
          closeContextMenu();
        }}
      >
        Duplicate Request
      </button>

      <div class="h-px bg-neutral-200 dark:bg-[#383838] my-1"></div>

      <button
        class="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors"
        onclick={() => {
          if (itemContextMenu) {
            const item = itemContextMenu.item;
            const currentName =
              item.display_name || item.name.replace(/\.(curl|grpcurl)$/, '');
            closeContextMenu();
            workspaceState.renameItem(item.path, currentName);
          } else {
            closeContextMenu();
          }
        }}
      >
        Rename Request
      </button>

      <button
        class="w-full text-left px-3 py-1.5 hover:bg-rose-600 hover:text-white text-rose-600 dark:text-rose-400 transition-colors"
        onclick={() => {
          if (itemContextMenu) {
            workspaceState.deleteItem(itemContextMenu.item.path, itemContextMenu.item.name);
          }
          closeContextMenu();
        }}
      >
        Delete Request
      </button>
    {/if}
  </div>
{/if}
