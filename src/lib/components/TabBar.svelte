<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { Plus, X } from '$lib/components/icons';

  let contextMenu = $state<{
    visible: boolean;
    x: number;
    y: number;
    tabId: string;
  } | null>(null);

  function getBadgeClass(method: string) {
    switch (method.toUpperCase()) {
      case 'GET':
        return 'text-blue-600 dark:text-blue-400 bg-blue-500/10';
      case 'POST':
        return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10';
      case 'PUT':
        return 'text-amber-600 dark:text-amber-400 bg-amber-500/10';
      case 'DELETE':
        return 'text-rose-600 dark:text-rose-400 bg-rose-500/10';
      case 'PATCH':
        return 'text-purple-600 dark:text-purple-400 bg-purple-500/10';
      case 'GRPC':
        return 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10';
      default:
        return 'text-neutral-500 bg-neutral-200 dark:bg-neutral-800';
    }
  }

  function handleContextMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    contextMenu = {
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tabId,
    };
  }

  function closeContextMenu() {
    contextMenu = null;
  }
</script>

<svelte:window onclick={closeContextMenu} />

<div class="h-9 bg-[#f0f0f3] dark:bg-[#181818] border-b border-[#e5e5e5] dark:border-[#2d2d2d] flex items-center select-none overflow-x-auto text-xs shrink-0">
  <div class="flex items-center h-full">
    {#each workspaceState.tabs as tab (tab.id)}
      {@const isActive = tab.id === workspaceState.activeTabId}
      <div
        role="tab"
        tabindex="0"
        aria-selected={isActive}
        onclick={() => (workspaceState.activeTabId = tab.id)}
        ondblclick={() => workspaceState.pinTab(tab.id)}
        oncontextmenu={(e) => handleContextMenu(e, tab.id)}
        onkeydown={(e) => e.key === 'Enter' && (workspaceState.activeTabId = tab.id)}
        class="group relative flex items-center gap-1.5 h-full px-3 border-r border-[#e5e5e5] dark:border-[#2d2d2d] cursor-pointer transition-colors max-w-[200px] {isActive
          ? 'bg-white dark:bg-[#1e1e1e] text-neutral-900 dark:text-white font-medium border-t-2 border-t-blue-500 -mt-px'
          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/50 dark:hover:bg-[#222222]'}"
      >
        <!-- Method Badge -->
        <span class="text-[9px] font-mono font-bold px-1 py-0.2 rounded leading-tight {getBadgeClass(tab.method)}">
          {tab.method}
        </span>

        <!-- Tab Name -->
        <span class="truncate flex-1 text-[11px] {tab.isPinned ? '' : 'italic opacity-90'}" title={tab.name}>
          {tab.name}
        </span>

        <!-- Dirty Indicator -->
        {#if tab.isDirty}
          <span class="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
        {/if}

        <!-- Close Button -->
        <button
          type="button"
          onclick={(e) => {
            e.stopPropagation();
            workspaceState.closeTab(tab.id);
          }}
          title="Close Tab"
          class="p-0.5 rounded text-neutral-400 hover:text-neutral-800 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors opacity-0 group-hover:opacity-100 {isActive ? 'opacity-100' : ''}"
        >
          <X size={11} />
        </button>
      </div>
    {/each}
  </div>

  <!-- Plus New Tab Button -->
  <button
    type="button"
    onclick={() => workspaceState.createNewRequest()}
    title="New Request Tab"
    class="p-1.5 ml-1 text-neutral-500 hover:text-neutral-800 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-[#252526] rounded transition-colors"
  >
    <Plus size={13} />
  </button>
</div>

<!-- Tab Right-Click Context Menu -->
{#if contextMenu && contextMenu.visible}
  <div
    class="fixed z-50 bg-white dark:bg-[#252526] border border-neutral-200 dark:border-[#383838] rounded-md shadow-xl py-1 text-xs text-neutral-700 dark:text-neutral-200 w-44"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
  >
    <button
      class="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors"
      onclick={() => {
        if (contextMenu) workspaceState.closeTab(contextMenu.tabId);
        closeContextMenu();
      }}
    >
      Close Tab
    </button>
    <button
      class="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors"
      onclick={() => {
        if (contextMenu) workspaceState.closeOtherTabs(contextMenu.tabId);
        closeContextMenu();
      }}
    >
      Close Other Tabs
    </button>
    <button
      class="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors"
      onclick={() => {
        if (contextMenu) workspaceState.closeTabsToTheRight(contextMenu.tabId);
        closeContextMenu();
      }}
    >
      Close Tabs to the Right
    </button>
    <div class="h-px bg-neutral-200 dark:bg-[#383838] my-1"></div>
    <button
      class="w-full text-left px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors"
      onclick={() => {
        if (contextMenu) workspaceState.pinTab(contextMenu.tabId);
        closeContextMenu();
      }}
    >
      Pin Tab (Keep Open)
    </button>
  </div>
{/if}
