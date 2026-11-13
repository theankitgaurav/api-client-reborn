<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { historyState } from '$lib/state/history.svelte';
  import { envState } from '$lib/state/env.svelte';
  import { shortcutsState } from '$lib/state/shortcuts.svelte';
  import { uiState } from '$lib/state/ui.svelte';
  import { readRequestFile } from '$lib/ipc';
  import HistoryPanel from './HistoryPanel.svelte';
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
  import Kbd from '$lib/components/ui/Kbd.svelte';
  import { getResolvedCommand } from '$lib/utils/curl-generator';
  import { COLLECTION_EXPORT_LABEL } from '$lib/utils/collection-exporter';
  import { createFolderFromName } from '$lib/utils/folder-creation';
  import { parseGrpcRequest, resolveGrpcVariables, toGrpcurl } from '$lib/utils/grpc';
  import type { WorkspaceFileItem } from '$lib/types';
  import {
    FolderOpen,
    Folder,
    RefreshCw,
    Search,
    Plus,
    Upload,
    FolderPlus,
    Check,
    MoreVertical,
    Clock,
    Layers,
    X,
  } from '$lib/components/icons';

  let isMac = $derived(shortcutsState.isMac);
  let searchQuery = $state('');
  let activeSidebarTab = $state<'requests' | 'history'>('requests');
  let collapsedFolderPaths = $state<string[]>([]);
  let hasInitializedFolderDefaults = false;
  let pendingDeleteItem = $state<WorkspaceFileItem | null>(null);
  let isDeletingItem = $state(false);
  let isNewFolderDialogOpen = $state(false);
  let newFolderName = $state('');
  let newFolderError = $state('');
  let isCreatingFolder = $state(false);

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

  function isFolderExpanded(path: string): boolean {
    return !collapsedFolderPaths.includes(path);
  }

  function toggleFolder(path: string) {
    collapsedFolderPaths = isFolderExpanded(path)
      ? [...collapsedFolderPaths, path]
      : collapsedFolderPaths.filter((collapsedPath) => collapsedPath !== path);
  }

  $effect(() => {
    void historyState.load(workspaceState.workspacePath);
  });

  $effect(() => {
    const tree = workspaceState.tree;
    if (hasInitializedFolderDefaults || tree.length === 0) return;
    const examplesFolder = tree.find((item) => item.is_dir && item.name.toLowerCase() === 'examples');
    if (examplesFolder) collapsedFolderPaths = [examplesFolder.path];
    hasInitializedFolderDefaults = true;
  });

  let copyNotification = $state<{ text: string; visible: boolean } | null>(null);
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  async function copyToClipboardWithFallback(text: string): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall through to textarea fallback
      }
    }

    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch {
      return false;
    }
  }

  async function copyRequestCommand(item: WorkspaceFileItem) {
    try {
      let rawContent = '';
      const openTab = workspaceState.tabs.find((t) => t.filePath === item.path);
      if (openTab) {
        rawContent = openTab.rawContent;
      } else {
        const details = await readRequestFile(item.path);
        rawContent = details.raw_content;
      }

      const isGrpc = item.kind === 'grpc' || /\.(?:grpcurl|grpc)$/i.test(item.name);
      const variables = await envState.variablesForRequest(openTab?.filePath || item.path);
      const resolved = isGrpc
        ? toGrpcurl(resolveGrpcVariables(parseGrpcRequest(rawContent), variables))
        : getResolvedCommand(rawContent, variables);
      await copyToClipboardWithFallback(resolved);

      if (copyTimeout) clearTimeout(copyTimeout);
      copyNotification = {
        text: `${isGrpc ? 'grpcurl' : 'cURL'} copied for "${item.display_name || item.name}"`,
        visible: true,
      };
      copyTimeout = setTimeout(() => {
        copyNotification = null;
      }, 2500);
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
    const menuWidth = 192;
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

  function handleDeleteItem(item: WorkspaceFileItem) {
    closeContextMenu();
    pendingDeleteItem = item;
  }

  async function confirmDeleteItem() {
    if (!pendingDeleteItem || isDeletingItem) return;
    const item = pendingDeleteItem;
    isDeletingItem = true;
    try {
      await workspaceState.deleteItem(item.path, item.name);
      pendingDeleteItem = null;
    } finally {
      isDeletingItem = false;
    }
  }

  function handleCreateFolder() {
    newFolderName = '';
    newFolderError = '';
    isNewFolderDialogOpen = true;
  }

  async function submitNewFolder() {
    if (isCreatingFolder) return;
    newFolderError = '';
    isCreatingFolder = true;
    try {
      const created = await createFolderFromName(newFolderName, (name) =>
        workspaceState.createFolder('.', name)
      );
      if (!created) {
        newFolderError = 'Enter a folder name.';
        return;
      }
      isNewFolderDialogOpen = false;
    } catch (error) {
      newFolderError = error instanceof Error ? error.message : String(error);
    } finally {
      isCreatingFolder = false;
    }
  }

  function getBadgeClass(methodOrKind: string): string {
    const key = methodOrKind.toUpperCase();
    switch (key) {
      case 'GET': return 'badge-get';
      case 'POST': return 'badge-post';
      case 'PUT': return 'badge-put';
      case 'DELETE': return 'badge-delete';
      case 'PATCH': return 'badge-patch';
      case 'GRPC': return 'badge-grpc';
      default: return 'badge-request';
    }
  }
</script>

<svelte:window onclick={closeContextMenu} />

<aside
  class="{uiState.sidebarCollapsed ? 'w-12' : 'w-60'} flex h-full shrink-0 select-none flex-col border-r border-[var(--border)] bg-[var(--surface-muted)] text-xs transition-[width] duration-150 overflow-hidden"
>
  {#if uiState.sidebarCollapsed}
    <!-- Collapsed Minimal Rail -->
    <div class="flex flex-col items-center gap-2 py-2.5">
      <button
        type="button"
        class="ui-icon-button bg-[var(--surface)] text-[var(--accent)] shadow-sm"
        aria-label="Expand workspace sidebar"
        title="Expand workspace sidebar ({isMac ? '⌘\\' : 'Ctrl+\\'})"
        onclick={() => uiState.setSidebarCollapsed(false)}
      >
        <Layers size={14} />
      </button>
      <div class="my-0.5 h-px w-5 bg-[var(--border)]"></div>
      <button
        type="button"
        class="ui-icon-button"
        aria-label="New request"
        title="New request ({isMac ? '⌘N' : 'Ctrl+N'})"
        onclick={() => workspaceState.createNewRequest()}
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        class="ui-icon-button"
        aria-label="Search requests"
        title="Search requests ({isMac ? '⌘F' : 'Ctrl+F'})"
        onclick={() => {
          uiState.setSidebarCollapsed(false);
          requestAnimationFrame(() => document.getElementById('sidebar-filter-input')?.focus());
        }}
      >
        <Search size={14} />
      </button>
      <button
        type="button"
        class="ui-icon-button"
        aria-label="Show history"
        title="Show history"
        onclick={() => {
          uiState.setSidebarCollapsed(false);
          activeSidebarTab = 'history';
        }}
      >
        <Clock size={14} />
      </button>
    </div>
  {:else}
    <!-- Top Tabs: Requests & History -->
    <div class="p-2 pb-1.5 flex items-center justify-between border-b border-[var(--border)]">
      <SegmentedControl
        items={[
          { id: 'requests', label: 'Requests', count: countRequests(workspaceState.tree) },
          { id: 'history', label: 'History', count: historyState.entries.length },
        ]}
        activeId={activeSidebarTab}
        onchange={(id) => (activeSidebarTab = id as 'requests' | 'history')}
        size="sm"
        class="w-full justify-center"
      />
    </div>

    {#if activeSidebarTab === 'requests'}
      <!-- Requests Toolbar Actions -->
      <div class="px-2.5 py-1.5 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-muted)] text-[11px]">
        <div class="flex items-center gap-1">
          <button
            type="button"
            onclick={() => workspaceState.createNewRequest()}
            title="New Request ({isMac ? '⌘N' : 'Ctrl+N'})"
            class="inline-flex items-center gap-1 rounded bg-[var(--accent)] hover:bg-[var(--accent-strong)] text-white px-2 py-0.5 text-[10px] font-medium transition-all active:scale-[0.98]"
          >
            <Plus size={11} />
            <span>New</span>
          </button>
        </div>

        <div class="flex items-center gap-0.5 text-[var(--text-muted)]">
          <button
            type="button"
            onclick={handleCreateFolder}
            title="New Folder / Collection"
            aria-label="New folder"
            class="ui-icon-button"
          >
            <FolderPlus size={13} />
          </button>

          <button
            type="button"
            onclick={() => workspaceState.openImportModal()}
            title="Import Collection or cURL"
            aria-label="Import collection"
            class="ui-icon-button"
          >
            <Upload size={13} />
          </button>

          <button
            type="button"
            onclick={() => workspaceState.refreshTree()}
            title="Refresh workspace files"
            aria-label="Refresh workspace"
            class="ui-icon-button"
          >
            <RefreshCw size={12} class={workspaceState.isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <!-- Filter / Search Input -->
      <div class="p-2 border-b border-[var(--border)]">
        <div class="relative w-full">
          <Search size={12} class="absolute left-2 top-2 text-[var(--text-subtle)]" />
          <input
            id="sidebar-filter-input"
            type="text"
            placeholder="Filter requests… ({isMac ? '⌘F' : 'Ctrl+F'})"
            bind:value={searchQuery}
            class="w-full bg-[var(--surface)] border border-[var(--border)] rounded pl-6.5 pr-2 py-1 text-[11px] text-[var(--text-strong)] placeholder:text-[var(--text-subtle)] outline-none focus:border-[var(--focus)] transition-colors"
          />
          {#if searchQuery}
            <button
              type="button"
              onclick={() => (searchQuery = '')}
              aria-label="Clear filter"
              class="absolute right-1.5 top-1.5 text-[var(--text-subtle)] hover:text-[var(--text-strong)]"
            >
              <X size={12} />
            </button>
          {/if}
        </div>
      </div>

      <!-- Workspace Collection Tree -->
      <div class="flex-1 overflow-y-auto p-1 space-y-0.5">
        {#snippet renderNode(item: WorkspaceFileItem, depth: number)}
          {#if item.is_dir}
            <div class="mb-0.5" style="padding-left: {depth * 8}px;">
              <div
                role="group"
                aria-label="Collection {item.name}"
                oncontextmenu={(e) => handleItemContextMenu(e, item)}
                class="group flex h-6.5 items-center justify-between px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:bg-[var(--surface-hover)] rounded transition-colors"
              >
                <button
                  type="button"
                  aria-expanded={isFolderExpanded(item.path)}
                  aria-label="{isFolderExpanded(item.path) ? 'Collapse' : 'Expand'} collection {item.name}"
                  onclick={() => toggleFolder(item.path)}
                  class="flex items-center gap-1.5 truncate flex-1 text-left outline-none"
                  title="Click to {isFolderExpanded(item.path) ? 'collapse' : 'expand'}"
                >
                  <span class="text-[9px] text-[var(--text-subtle)] transition-transform duration-100 {isFolderExpanded(item.path) ? 'rotate-90' : ''}">
                    ▶
                  </span>
                  {#if isFolderExpanded(item.path)}
                    <FolderOpen size={12} class="text-[var(--accent)] shrink-0" />
                  {:else}
                    <Folder size={12} class="text-[var(--text-muted)] shrink-0" />
                  {/if}
                  <span class="truncate normal-case text-[11px] font-medium text-[var(--text-strong)]">{item.name}</span>
                </button>

                <div class="flex items-center gap-0.5 transition-opacity {itemContextMenu?.visible && itemContextMenu.item.path === item.path ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}">
                  <button
                    type="button"
                    onclick={(e) => {
                      e.stopPropagation();
                      workspaceState.createNewRequestInFolder(item.path);
                    }}
                    title="New Request in folder"
                    class="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-strong)] rounded"
                  >
                    <Plus size={11} />
                  </button>
                  <button
                    type="button"
                    onclick={(e) => toggleContextMenuForElement(e, item)}
                    title="Folder options"
                    class="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-strong)] rounded"
                  >
                    <MoreVertical size={11} />
                  </button>
                </div>
              </div>

              {#if isFolderExpanded(item.path)}
                {#if item.children && item.children.length > 0}
                  <div class="space-y-0.5 mt-0.5">
                    {#each item.children as child}
                      {@render renderNode(child, depth + 1)}
                    {/each}
                  </div>
                {:else}
                  <div class="pl-5 py-1 text-[10px] text-[var(--text-subtle)] italic">
                    Empty folder
                  </div>
                {/if}
              {/if}
            </div>
          {:else}
            <div style="padding-left: {depth * 8}px;">
              <div
                role="button"
                tabindex="0"
                onclick={() => workspaceState.openRequest(item.path, false)}
                ondblclick={() => workspaceState.openRequest(item.path, true)}
                oncontextmenu={(e) => handleItemContextMenu(e, item)}
                onkeydown={(e) => e.key === 'Enter' && workspaceState.openRequest(item.path, false)}
                class="group flex h-6.5 items-center justify-between px-1.5 py-0.5 rounded transition-all cursor-pointer text-left {workspaceState.activeFilePath === item.path
                  ? 'bg-[var(--surface)] text-[var(--accent)] font-medium shadow-sm border border-[var(--border)]'
                  : 'text-[var(--text)] hover:bg-[var(--surface-hover)]'}"
              >
                <div class="flex items-center gap-1.5 truncate flex-1 mr-1">
                  <span
                    class="text-[9px] font-mono font-bold px-1 py-0.2 rounded leading-none shrink-0 {getBadgeClass(item.kind === 'grpc' ? 'gRPC' : item.method || 'REQ')}"
                  >
                    {item.kind === 'grpc' ? 'gRPC' : item.method || 'REQ'}
                  </span>
                  <span class="truncate text-[11px]">{item.display_name || item.name}</span>
                </div>

                <button
                  type="button"
                  onclick={(e) => toggleContextMenuForElement(e, item)}
                  title="Request options"
                  class="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-strong)] rounded transition-opacity {itemContextMenu?.visible && itemContextMenu.item.path === item.path
                    ? 'opacity-100 text-[var(--text-strong)]'
                    : 'opacity-0 group-hover:opacity-100'}"
                >
                  <MoreVertical size={11} />
                </button>
              </div>
            </div>
          {/if}
        {/snippet}

        {#each filteredTree as item}
          {@render renderNode(item, 0)}
        {/each}

        {#if filteredTree.length === 0}
          <div class="text-center py-6 text-[11px] text-[var(--text-subtle)]">
            No request files found
          </div>
        {/if}
      </div>
    {:else}
      <HistoryPanel />
    {/if}
  {/if}
</aside>

<!-- Context Menu -->
{#if itemContextMenu && itemContextMenu.visible}
  {@const menuItem = itemContextMenu.item}
  <div
    role="menu"
    tabindex="-1"
    class="ui-menu-surface fixed z-50 w-44 text-[11px] select-none"
    style="left: {itemContextMenu.x}px; top: {itemContextMenu.y}px;"
    onclick={(event) => event.stopPropagation()}
    onkeydown={(event) => event.key === 'Escape' && closeContextMenu()}
  >
    {#if itemContextMenu.item.is_dir}
      <button
        type="button"
        class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-strong)] transition-colors flex items-center justify-between"
        onclick={() => {
          if (itemContextMenu) workspaceState.createNewRequestInFolder(itemContextMenu.item.path);
          closeContextMenu();
        }}
      >
        <span>New Request Here</span>
      </button>

      <button
        type="button"
        class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-strong)] transition-colors flex items-center justify-between"
        onclick={() => {
          if (itemContextMenu) {
            const sub = prompt('Enter subfolder name:');
            if (sub && sub.trim()) {
              void workspaceState.createFolder(itemContextMenu.item.path, sub.trim()).catch((error) => {
                alert(`Failed to create folder: ${error instanceof Error ? error.message : String(error)}`);
              });
            }
          }
          closeContextMenu();
        }}
      >
        <span>New Subfolder</span>
      </button>

      <div class="h-px bg-[var(--border)] my-1"></div>

      <button
        type="button"
        class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-strong)] transition-colors flex items-center justify-between"
        onclick={() => {
          if (itemContextMenu) workspaceState.openExportModal(itemContextMenu.item);
          closeContextMenu();
        }}
      >
        <span>{COLLECTION_EXPORT_LABEL}</span>
      </button>

      <div class="h-px bg-[var(--border)] my-1"></div>

      <button
        type="button"
        class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-strong)] transition-colors"
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
        type="button"
        class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-[var(--danger)] transition-colors"
        onclick={(event) => {
          event.stopPropagation();
          handleDeleteItem(menuItem);
        }}
      >
        Delete Folder
      </button>
    {:else}
      <button
        type="button"
        class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-strong)] transition-colors"
        onclick={() => {
          if (itemContextMenu) workspaceState.openRequest(itemContextMenu.item.path, true);
          closeContextMenu();
        }}
      >
        Open in New Tab
      </button>

      <button
        type="button"
        class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-strong)] transition-colors"
        onclick={() => {
          if (itemContextMenu) workspaceState.openRequest(itemContextMenu.item.path, false);
          closeContextMenu();
        }}
      >
        Open in Current Tab
      </button>

      <div class="h-px bg-[var(--border)] my-1"></div>

      <button
        type="button"
        class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-strong)] transition-colors"
        onclick={() => {
          if (itemContextMenu) copyRequestCommand(itemContextMenu.item);
          closeContextMenu();
        }}
      >
        {itemContextMenu.item.kind === 'grpc' || /\.(?:grpcurl|grpc)$/i.test(itemContextMenu.item.name) ? 'Copy as grpcurl' : 'Copy as cURL'}
      </button>

      <button
        type="button"
        class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-strong)] transition-colors"
        onclick={() => {
          if (itemContextMenu) workspaceState.duplicateRequest(itemContextMenu.item.path);
          closeContextMenu();
        }}
      >
        Duplicate Request
      </button>

      <div class="h-px bg-[var(--border)] my-1"></div>

      <button
        type="button"
        class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-strong)] transition-colors"
        onclick={() => {
          if (itemContextMenu) {
            const item = itemContextMenu.item;
            const currentName = item.display_name || item.name.replace(/\.curl$/, '');
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
        type="button"
        class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-[var(--danger)] transition-colors"
        onclick={(event) => {
          event.stopPropagation();
          handleDeleteItem(menuItem);
        }}
      >
        Delete Request
      </button>
    {/if}
  </div>
{/if}

<!-- In-Sidebar Delete Dialog -->
{#if pendingDeleteItem}
  {@const deletingFolder = pendingDeleteItem.is_dir}
  <div
    class="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget && !isDeletingItem) pendingDeleteItem = null;
    }}
  >
    <div
      role="alertdialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="delete-item-title"
      aria-describedby="delete-item-description"
      class="w-full max-w-sm rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-2xl text-xs overflow-hidden"
    >
      <div class="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-muted)]">
        <h2 id="delete-item-title" class="text-xs font-semibold text-[var(--text-strong)]">
          Delete {deletingFolder ? 'Folder' : 'Request'}?
        </h2>
      </div>
      <div id="delete-item-description" class="px-4 py-3.5 text-[var(--text)]">
        <p>“{pendingDeleteItem.display_name || pendingDeleteItem.name}” will be permanently deleted from the workspace.</p>
        {#if deletingFolder}
          <p class="mt-1.5 text-[var(--text-muted)]">All requests inside this folder will also be deleted.</p>
        {/if}
      </div>
      <div class="px-4 py-2.5 bg-[var(--surface-muted)] border-t border-[var(--border)] flex justify-end gap-2">
        <button
          type="button"
          disabled={isDeletingItem}
          onclick={() => (pendingDeleteItem = null)}
          class="ui-button ui-button-secondary h-7 px-3 text-[11px]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={isDeletingItem}
          onclick={confirmDeleteItem}
          class="ui-button ui-button-danger h-7 px-3 text-[11px] font-medium"
        >
          {isDeletingItem ? 'Deleting…' : `Delete ${deletingFolder ? 'Folder' : 'Request'}`}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- In-Sidebar New Folder Dialog -->
{#if isNewFolderDialogOpen}
  <div
    class="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget && !isCreatingFolder) isNewFolderDialogOpen = false;
    }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-folder-title"
      class="w-full max-w-sm rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-2xl text-xs overflow-hidden"
    >
      <form
        onsubmit={(event) => {
          event.preventDefault();
          void submitNewFolder();
        }}
      >
        <div class="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-muted)]">
          <h2 id="new-folder-title" class="text-xs font-semibold text-[var(--text-strong)]">
            New Folder / Collection
          </h2>
        </div>
        <div class="px-4 py-3.5 space-y-1.5">
          <label for="new-folder-name" class="block text-[11px] text-[var(--text-muted)] font-medium">
            Folder name
          </label>
          <input
            id="new-folder-name"
            bind:value={newFolderName}
            disabled={isCreatingFolder}
            class="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text-strong)] outline-none focus:border-[var(--focus)]"
            placeholder="Enter a folder name"
          />
          {#if newFolderError}
            <p role="alert" class="mt-1 text-[10px] text-[var(--danger)]">{newFolderError}</p>
          {/if}
        </div>
        <div class="px-4 py-2.5 bg-[var(--surface-muted)] border-t border-[var(--border)] flex justify-end gap-2">
          <button
            type="button"
            disabled={isCreatingFolder}
            onclick={() => (isNewFolderDialogOpen = false)}
            class="ui-button ui-button-secondary h-7 px-3 text-[11px]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isCreatingFolder}
            class="ui-button ui-button-primary h-7 px-3 text-[11px]"
          >
            {isCreatingFolder ? 'Creating…' : 'Create Folder'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Toast Feedback -->
{#if copyNotification && copyNotification.visible}
  <div
    class="fixed bottom-3 left-4 z-50 bg-[var(--surface-raised)] text-[var(--text-strong)] text-[11px] px-3 py-1.5 rounded-md shadow-xl border border-[var(--border-strong)] flex items-center gap-2 pointer-events-none transition-all"
  >
    <Check size={12} class="text-[var(--success)]" />
    <span>{copyNotification.text}</span>
  </div>
{/if}
