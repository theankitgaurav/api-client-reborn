<script lang="ts">
  import { uiState, type CommandPaletteItem, type PaletteGroup } from '$lib/state/ui.svelte';
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { responseState } from '$lib/state/response.svelte';
  import { envState } from '$lib/state/env.svelte';
  import { historyState } from '$lib/state/history.svelte';
  import { themeState } from '$lib/state/theme.svelte';
  import { shortcutsState } from '$lib/state/shortcuts.svelte';
  import { filterCommandItems } from '$lib/utils/command-palette';
  import Kbd from '$lib/components/ui/Kbd.svelte';
  import { X, Search, Clock, FolderOpen, Save, Play, Moon, Keyboard, Layers } from '$lib/components/icons';

  let searchInput = $state<HTMLInputElement>();
  let groupOrder: PaletteGroup[] = ['Actions', 'Requests', 'Tabs', 'History', 'Environments'];
  let isMac = $derived(shortcutsState.isMac);

  function close() {
    uiState.closeCommandPalette();
  }

  function actionItems(): CommandPaletteItem[] {
    return [
      { id: 'new-request', label: 'New HTTP request', description: 'Create a request in a new tab', group: 'Actions', shortcut: isMac ? '⌘ N' : 'Ctrl N', keywords: ['create', 'new'], run: () => workspaceState.createNewRequest() },
      { id: 'new-grpc-request', label: 'New gRPC request', description: 'Create a gRPC request in a new tab', group: 'Actions', keywords: ['create', 'grpc'], run: () => workspaceState.createNewGrpcRequest() },
      { id: 'send-request', label: responseState.isExecuting ? 'Cancel request' : 'Send request', description: 'Execute the active request', group: 'Actions', shortcut: isMac ? '⌘ ↵' : 'Ctrl ↵', keywords: ['run', 'execute'], run: () => responseState.isExecuting ? responseState.cancel() : responseState.runCurrentRequest() },
      { id: 'save-request', label: 'Save request', description: 'Save the active request to disk', group: 'Actions', shortcut: isMac ? '⌘ S' : 'Ctrl S', keywords: ['write', 'persist'], run: () => workspaceState.saveActiveFile() },
      { id: 'toggle-sidebar', label: uiState.sidebarCollapsed ? 'Show workspace sidebar' : 'Collapse workspace sidebar', description: 'Toggle the collection and history rail', group: 'Actions', keywords: ['panel', 'sidebar'], run: () => uiState.toggleSidebar() },
      { id: 'focus-url', label: 'Focus request URL', description: 'Jump to the active endpoint field', group: 'Actions', shortcut: isMac ? '⌘ L' : 'Ctrl L', keywords: ['url', 'endpoint'], run: () => document.getElementById('request-url-input')?.focus() },
      { id: 'focus-filter', label: 'Filter requests', description: 'Search the current workspace', group: 'Actions', shortcut: isMac ? '⌘ F' : 'Ctrl F', keywords: ['search', 'find'], run: () => document.getElementById('sidebar-filter-input')?.focus() },
      { id: 'variables', label: 'Open variables and secrets', description: `Edit ${envState.activeEnvName} variables`, group: 'Actions', shortcut: isMac ? '⌘ E' : 'Ctrl E', keywords: ['environment', 'env', 'secret'], run: () => (envState.isVariablesModalOpen = true) },
      { id: 'theme', label: `Switch theme (${themeState.mode})`, description: 'Cycle system, light, and dark appearance', group: 'Actions', keywords: ['appearance', 'dark', 'light'], run: () => themeState.cycleMode() },
      { id: 'shortcuts', label: 'Keyboard shortcuts', description: 'Open the shortcut reference', group: 'Actions', shortcut: isMac ? '⌘ /' : 'Ctrl /', keywords: ['help', 'keys'], run: () => shortcutsState.openCheatSheet() },
      { id: 'workspace', label: 'Choose workspace', description: 'Switch the active workspace folder', group: 'Actions', keywords: ['folder', 'project'], run: () => document.querySelector<HTMLElement>('[data-workspace-picker] button')?.click() },
    ];
  }

  function navigationItems(): CommandPaletteItem[] {
    const requests: CommandPaletteItem[] = [];
    const visit = (items: typeof workspaceState.tree) => {
      for (const item of items) {
        if (item.is_dir && item.children) visit(item.children);
        else if (!item.is_dir) requests.push({
          id: `request:${item.path}`,
          label: item.display_name || item.name,
          description: item.path,
          group: 'Requests',
          keywords: [item.method || '', item.kind || ''],
          run: () => workspaceState.openRequest(item.path, true),
        });
      }
    };
    visit(workspaceState.tree);

    const tabs = workspaceState.tabs.map((tab) => ({
      id: `tab:${tab.id}`,
      label: tab.name,
      description: `${tab.method}${tab.isDirty ? ' · unsaved' : ''}`,
      group: 'Tabs' as const,
      keywords: [tab.filePath || ''],
      run: () => { workspaceState.activeTabId = tab.id; },
    }));

    const history = historyState.entries.slice(0, 20).map((entry) => ({
      id: `history:${entry.id}`,
      label: entry.request_name || entry.url || 'Request history',
      description: `${entry.method} · ${entry.status || 'no status'} · ${entry.url || 'saved response'}`,
      group: 'History' as const,
      keywords: [entry.url, entry.status_text],
      run: () => { workspaceState.openHistoryEntry(entry); },
    }));

    const environments = envState.environments.map((environment) => ({
      id: `environment:${environment.name}`,
      label: environment.name,
      description: environment.name === envState.activeEnvName ? 'Active environment' : 'Switch active environment',
      group: 'Environments' as const,
      keywords: ['environment', 'variables'],
      run: () => envState.selectEnvironment(environment.name),
    }));

    return [...requests, ...tabs, ...history, ...environments];
  }

  let items = $derived([...actionItems(), ...navigationItems()]);

  let filteredItems = $derived.by(() => {
    return filterCommandItems(items, uiState.commandQuery);
  });

  $effect(() => {
    if (uiState.isCommandPaletteOpen) requestAnimationFrame(() => searchInput?.focus());
  });

  $effect(() => {
    if (uiState.commandIndex >= filteredItems.length) uiState.commandIndex = Math.max(0, filteredItems.length - 1);
  });

  function run(item: CommandPaletteItem) {
    close();
    void item.run();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); uiState.commandIndex = Math.min(filteredItems.length - 1, uiState.commandIndex + 1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); uiState.commandIndex = Math.max(0, uiState.commandIndex - 1); return; }
    if (event.key === 'Enter' && filteredItems[uiState.commandIndex]) { event.preventDefault(); run(filteredItems[uiState.commandIndex]); }
  }
</script>

{#if uiState.isCommandPaletteOpen}
  <div
    class="fixed inset-0 z-[100] bg-black/45 p-4 pt-[12vh] backdrop-blur-[1px] select-none"
    role="presentation"
    onclick={(event) => event.target === event.currentTarget && close()}
  >
    <div
      class="ui-menu-surface mx-auto w-full max-w-[600px] overflow-hidden p-0 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div class="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 bg-[var(--surface-muted)]">
        <Search size={15} class="text-[var(--text-subtle)]" />
        <input
          bind:this={searchInput}
          bind:value={uiState.commandQuery}
          onkeydown={handleKeydown}
          placeholder="Type a command or search requests…"
          class="h-8 min-w-0 flex-1 bg-transparent text-xs text-[var(--text-strong)] outline-none placeholder:text-[var(--text-subtle)]"
        />
        <Kbd>Esc</Kbd>
        <button type="button" aria-label="Close command palette" onclick={close} class="ui-icon-button">
          <X size={13} />
        </button>
      </div>

      <div class="max-h-[min(60vh,460px)] overflow-y-auto p-1.5 bg-[var(--surface)]">
        {#if filteredItems.length === 0}
          <div class="px-3 py-10 text-center text-xs text-[var(--text-subtle)]">
            No commands or workspace items match “{uiState.commandQuery}”.
          </div>
        {:else}
          {#each groupOrder as group}
            {@const groupItems = filteredItems.filter((item) => item.group === group)}
            {#if groupItems.length > 0}
              <div class="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
                {group}
              </div>
              {#each groupItems as item}
                {@const index = filteredItems.indexOf(item)}
                <button
                  type="button"
                  onclick={() => run(item)}
                  onmouseenter={() => (uiState.commandIndex = index)}
                  class="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left transition-colors {index === uiState.commandIndex ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--text-strong)]' : 'text-[var(--text)] hover:bg-[var(--surface-hover)]'}"
                >
                  <span class="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded bg-[var(--surface-muted)] text-[var(--text-muted)] border border-[var(--border)]">
                    {#if item.group === 'Requests'}<FolderOpen size={12} />{:else if item.group === 'Tabs'}<Layers size={12} />{:else if item.group === 'History'}<Clock size={12} />{:else if item.id.includes('save')}<Save size={12} />{:else if item.id.includes('send')}<Play size={12} />{:else if item.id === 'theme'}<Moon size={12} />{:else if item.id === 'shortcuts'}<Keyboard size={12} />{:else}<Search size={12} />{/if}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-xs font-medium text-[var(--text-strong)]">{item.label}</span>
                    {#if item.description}
                      <span class="block truncate text-[10px] text-[var(--text-muted)] font-mono">{item.description}</span>
                    {/if}
                  </span>
                  {#if item.shortcut}
                    <Kbd class="shrink-0 text-[9px]">{item.shortcut}</Kbd>
                  {/if}
                </button>
              {/each}
            {/if}
          {/each}
        {/if}
      </div>

      <div class="flex items-center justify-between border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--text-subtle)] bg-[var(--surface-muted)]">
        <span><kbd class="font-mono">↑↓</kbd> navigate · <kbd class="font-mono">↵</kbd> select · <kbd class="font-mono">esc</kbd> close</span>
        <span class="font-mono">{filteredItems.length} results</span>
      </div>
    </div>
  </div>
{/if}
