<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { shortcutsState } from '$lib/state/shortcuts.svelte';
  import { Plus, X } from '$lib/components/icons';

  let isMac = $derived(shortcutsState.isMac);

  let contextMenu = $state<{
    visible: boolean;
    x: number;
    y: number;
    tabId: string;
  } | null>(null);

  function getBadgeClass(method: string): string {
    switch (method.toUpperCase()) {
      case 'GET': return 'badge-get';
      case 'POST': return 'badge-post';
      case 'PUT': return 'badge-put';
      case 'DELETE': return 'badge-delete';
      case 'PATCH': return 'badge-patch';
      case 'GRPC': return 'badge-grpc';
      default: return 'badge-request';
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

<div class="flex h-8.5 shrink-0 items-center overflow-x-auto border-b border-[var(--border)] bg-[var(--surface-muted)] text-xs select-none">
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
        class="group relative flex h-full max-w-[210px] cursor-pointer items-center gap-1.5 border-r border-[var(--border)] px-2.5 transition-colors {isActive
          ? 'bg-[var(--surface)] font-medium text-[var(--text-strong)] border-t border-t-[var(--accent)] -mt-px'
          : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'}"
      >
        <!-- Method Badge -->
        <span class="text-[9px] font-mono font-bold px-1 py-0.2 rounded leading-none shrink-0 {getBadgeClass(tab.method)}">
          {tab.method}
        </span>

        <!-- Tab Name -->
        <span class="truncate flex-1 text-[11px] {tab.isPinned ? '' : 'italic opacity-90'}" title={tab.name}>
          {tab.name}
        </span>

        <!-- Dirty Indicator -->
        {#if tab.isDirty}
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--warning)] shrink-0" title="Unsaved changes"></span>
        {/if}

        <!-- Close Button -->
        <button
          type="button"
          onclick={(e) => {
            e.stopPropagation();
            workspaceState.closeTab(tab.id);
          }}
          title="Close Tab ({isMac ? '⌘W' : 'Ctrl+W'})"
          class="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:bg-[var(--surface-hover)] transition-colors opacity-0 group-hover:opacity-100 {isActive ? 'opacity-100' : ''} {isMac ? 'order-first mr-0.5' : 'order-last ml-0.5'}"
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
    title="New Request ({isMac ? '⌘N' : 'Ctrl+N'})"
    aria-label="New request"
    class="ui-icon-button ml-1 h-6 w-6"
  >
    <Plus size={13} />
  </button>
</div>

<!-- Tab Context Menu -->
{#if contextMenu && contextMenu.visible}
  <div
    role="menu"
    tabindex="-1"
    class="ui-menu-surface fixed z-50 w-44 text-[11px] select-none"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.key === 'Escape' && closeContextMenu()}
  >
    <button
      type="button"
      class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-strong)] transition-colors"
      onclick={() => {
        if (contextMenu) workspaceState.closeTab(contextMenu.tabId);
        closeContextMenu();
      }}
    >
      Close Tab
    </button>
    <button
      type="button"
      class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-strong)] transition-colors"
      onclick={() => {
        if (contextMenu) workspaceState.closeOtherTabs(contextMenu.tabId);
        closeContextMenu();
      }}
    >
      Close Other Tabs
    </button>
    <button
      type="button"
      class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-strong)] transition-colors"
      onclick={() => {
        if (contextMenu) workspaceState.closeTabsToTheRight(contextMenu.tabId);
        closeContextMenu();
      }}
    >
      Close Tabs to the Right
    </button>
    <div class="h-px bg-[var(--border)] my-1"></div>
    <button
      type="button"
      class="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-strong)] transition-colors"
      onclick={() => {
        if (contextMenu) workspaceState.pinTab(contextMenu.tabId);
        closeContextMenu();
      }}
    >
      Pin Tab (Keep Open)
    </button>
  </div>
{/if}
