<script lang="ts">
  import { envState } from '$lib/state/env.svelte';
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { themeState } from '$lib/state/theme.svelte';
  import { shortcutsState } from '$lib/state/shortcuts.svelte';
  import { responseState } from '$lib/state/response.svelte';
  import { historyState } from '$lib/state/history.svelte';
  import { updaterState } from '$lib/state/updater.svelte';
  import { uiState } from '$lib/state/ui.svelte';
  import { open } from '@tauri-apps/plugin-dialog';
  import { getWorkspaceHistory } from '$lib/ipc';
  import { buildWorkspaceOptions } from '$lib/utils/workspace-history';
  import {
    Layers,
    FolderOpen,
    Sun,
    Moon,
    Monitor,
    Check,
    Keyboard,
    Bot,
    Download,
    RefreshCw,
    Search,
  } from '$lib/components/icons';

  let isMac = $derived(shortcutsState.isMac);
  let isThemeMenuOpen = $state(false);
  let isWorkspaceMenuOpen = $state(false);
  let isSwitchingWorkspace = $state(false);
  let isLoadingWorkspaceHistory = $state(false);
  let workspaceMenuError = $state('');
  let defaultWorkspacePath = $state('');
  let recentWorkspacePaths = $state<string[]>([]);

  let workspaceName = $derived(getWorkspaceName(workspaceState.workspacePath));
  let workspaceOptions = $derived(buildWorkspaceOptions(defaultWorkspacePath, recentWorkspacePaths));

  function getWorkspaceName(path: string): string {
    return path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1) || 'Workspace';
  }

  function closeThemeMenuOutside(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('[data-theme-picker]')) isThemeMenuOpen = false;
    if (!target.closest('[data-workspace-picker]')) isWorkspaceMenuOpen = false;
  }

  function selectTheme(mode: 'system' | 'light' | 'dark') {
    themeState.setMode(mode);
    isThemeMenuOpen = false;
  }

  async function refreshWorkspaceHistory() {
    isLoadingWorkspaceHistory = true;
    try {
      const history = await getWorkspaceHistory();
      defaultWorkspacePath = history.default_workspace_path;
      recentWorkspacePaths = history.recent_workspace_paths;
    } finally {
      isLoadingWorkspaceHistory = false;
    }
  }

  async function toggleWorkspaceMenu() {
    isWorkspaceMenuOpen = !isWorkspaceMenuOpen;
    workspaceMenuError = '';
    if (!isWorkspaceMenuOpen) return;
    try {
      await refreshWorkspaceHistory();
    } catch (e) {
      workspaceMenuError = e instanceof Error ? e.message : String(e);
    }
  }

  async function switchToWorkspace(selected: string) {
    workspaceMenuError = '';
    if (selected === workspaceState.workspacePath) {
      isWorkspaceMenuOpen = false;
      return;
    }
    try {
      isSwitchingWorkspace = true;
      let dirtyHandled = false;
      if (workspaceState.isDirty) {
        const choice = prompt('Unsaved request: type “save”, “discard”, or “cancel”.', 'cancel')?.trim().toLowerCase();
        if (!choice || choice === 'cancel') return;
        if (choice === 'save') {
          await workspaceState.saveActiveFile();
          if (workspaceState.isDirty || workspaceState.isSaveModalOpen) return;
        } else if (choice !== 'discard') return;
        dirtyHandled = true;
      }

      await responseState.cancel();
      const changed = await workspaceState.switchWorkspace(selected, dirtyHandled);
      if (changed) {
        await envState.refresh();
        await historyState.load(workspaceState.workspacePath);
        await refreshWorkspaceHistory();
        isWorkspaceMenuOpen = false;
      }
    } catch (e) {
      workspaceMenuError = e instanceof Error ? e.message : String(e);
    } finally {
      isSwitchingWorkspace = false;
    }
  }

  async function chooseWorkspace() {
    workspaceMenuError = '';
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Choose workspace folder' });
      if (typeof selected === 'string') await switchToWorkspace(selected);
    } catch (e) {
      workspaceMenuError = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<svelte:window onclick={closeThemeMenuOutside} />

<header
  data-tauri-drag-region
  class="flex h-10 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-3 select-none transition-colors"
>
  <!-- App name at the extreme left, offset past macOS traffic lights -->
    <div class="flex items-center gap-2 pl-[76px]">
    <button
      type="button"
      onclick={() => updaterState.checkForUpdates({ manual: true })}
      title="API Client Reborn v{updaterState.currentVersion} • Check for updates"
      class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)]"
    >
      <Layers size={14} class="text-blue-500" />
      API Client Reborn
    </button>
    <div class="relative" data-workspace-picker>
      <button
        type="button"
        onclick={toggleWorkspaceMenu}
        title="Current workspace: {workspaceState.workspacePath}"
        aria-label="Workspace: {workspaceName}. Choose workspace"
        aria-haspopup="menu"
        aria-expanded={isWorkspaceMenuOpen}
        disabled={isSwitchingWorkspace}
        class="flex max-w-44 items-center gap-1 rounded-md border border-neutral-300/80 bg-white/60 px-1.5 py-1 text-[11px] font-medium text-neutral-600 transition-colors hover:border-neutral-400 hover:bg-white dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-300 dark:hover:bg-neutral-800 disabled:opacity-60"
      >
        <FolderOpen size={12} class="shrink-0 text-blue-500" />
        <span class="truncate">{workspaceName}</span>
        <span aria-hidden="true" class="shrink-0 text-[10px] opacity-70">⌄</span>
      </button>
      {#if isWorkspaceMenuOpen}
        <div
          role="menu"
          aria-label="Workspace options"
          class="absolute left-0 top-full z-[100] mt-2 w-80 rounded-md border border-neutral-200 bg-white p-2 text-neutral-800 shadow-xl dark:border-[#383838] dark:bg-[#252526] dark:text-neutral-200"
        >
          <div class="border-b border-neutral-100 px-2 pb-2 dark:border-neutral-700">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Current workspace</div>
            <div class="mt-1 break-all text-xs text-neutral-700 dark:text-neutral-200">{workspaceState.workspacePath}</div>
          </div>
          <div class="max-h-56 overflow-y-auto border-b border-neutral-100 py-1 dark:border-neutral-700">
            {#if isLoadingWorkspaceHistory}
              <p class="px-2 py-2 text-xs text-neutral-500">Loading workspaces…</p>
            {:else}
              {#each workspaceOptions as path, index}
                <button
                  type="button"
                  role="menuitem"
                  disabled={isSwitchingWorkspace}
                  title={path}
                  aria-label="Switch to {getWorkspaceName(path)}{index === 0 ? ', default workspace' : ''}"
                  onclick={() => switchToWorkspace(path)}
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-50"
                >
                  <FolderOpen size={14} class="shrink-0 text-blue-600 dark:text-blue-400" />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-xs">{getWorkspaceName(path)}</span>
                    <span class="truncate text-[10px] text-neutral-500">{path}</span>
                  </span>
                  {#if index === 0}
                    <span class="shrink-0 rounded bg-blue-500/10 px-1 py-0.5 text-[9px] text-blue-600 dark:text-blue-400">Default</span>
                  {/if}
                  {#if path === workspaceState.workspacePath}<Check size={13} class="shrink-0" />{/if}
                </button>
              {/each}
            {/if}
          </div>
          {#if workspaceState.workspaceError || workspaceMenuError}
            <p role="alert" class="px-2 pt-2 text-xs text-red-600 dark:text-red-400">{workspaceMenuError || workspaceState.workspaceError}</p>
          {/if}
          <button
            type="button"
            role="menuitem"
            disabled={isSwitchingWorkspace}
            onclick={chooseWorkspace}
            class="mt-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-50"
          >
            <FolderOpen size={14} class="text-blue-600 dark:text-blue-400" />
            <span class="flex-1">{isSwitchingWorkspace ? 'Opening workspace…' : 'Choose Workspace…'}</span>
          </button>
        </div>
      {/if}
    </div>
    {#if workspaceState.isDirty}
      <span class="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 font-medium">
        Unsaved
      </span>
    {/if}
  </div>

  <!-- Right: Theme Switcher & Variables Action -->
  <div class="flex items-center gap-1.5">
    <button
      type="button"
      onclick={() => uiState.openCommandPalette()}
      title="Command palette ({isMac ? '⌘K' : 'Ctrl+K'})"
      class="hidden items-center gap-2 rounded-md border px-2 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-strong)] sm:flex"
      style="border-color: var(--border)"
    >
      <Search size={12} />
      <span>Search</span>
      <kbd class="rounded border px-1 font-mono text-[10px]" style="border-color: var(--border)">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
    <!-- Update Available Badge -->
    {#if updaterState.hasUpdateNotification}
      <button
        onclick={() => updaterState.openModal()}
        title="Update v{updaterState.availableVersion} is available! Click to view details and install."
        class="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 text-xs font-medium transition-all"
      >
        <Download size={13} class="animate-bounce" />
        <span class="text-[11px] font-semibold">Update v{updaterState.availableVersion}</span>
      </button>
    {/if}

    <!-- MCP AI Integration Button -->
    <button
      onclick={() => (workspaceState.isMcpModalOpen = true)}
      title="AI & MCP Server Configuration"
      class="flex items-center gap-1.5 px-2 py-1 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-neutral-800 rounded transition-colors text-xs font-medium"
    >
      <Bot size={13} class="text-emerald-500" />
      <span class="text-[11px] font-medium hidden sm:inline">MCP</span>
    </button>

    <!-- Keyboard Shortcuts Button -->
    <button
      onclick={() => shortcutsState.toggleCheatSheet()}
      title="Keyboard Shortcuts ({isMac ? '⌘/' : 'Ctrl+/'})"
      class="p-1.5 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-neutral-800 rounded transition-colors"
    >
      <Keyboard size={14} />
    </button>

    <!-- Theme Picker -->
    <div class="relative" data-theme-picker>
      <button
        type="button"
        onclick={() => (isThemeMenuOpen = !isThemeMenuOpen)}
        title="Theme: {themeState.mode}"
        aria-label="Choose theme. Current theme: {themeState.mode}"
        aria-haspopup="menu"
        aria-expanded={isThemeMenuOpen}
        class="p-1.5 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-neutral-800 rounded transition-colors"
      >
        {#if themeState.mode === 'system'}
          <Monitor size={14} class="text-blue-600 dark:text-blue-400" />
        {:else if themeState.mode === 'light'}
          <Sun size={14} class="text-amber-500 dark:text-amber-400" />
        {:else}
          <Moon size={14} class="text-neutral-600 dark:text-neutral-300" />
        {/if}
      </button>

      {#if isThemeMenuOpen}
        <div
          role="menu"
          aria-label="Choose theme"
          class="absolute right-0 top-full z-50 mt-2 w-44 rounded-md border border-neutral-200 bg-white p-1 text-neutral-800 shadow-xl dark:border-[#383838] dark:bg-[#252526] dark:text-neutral-200"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={themeState.mode === 'system'}
            onclick={() => selectTheme('system')}
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            <Monitor size={14} class="text-blue-600 dark:text-blue-400" />
            <span class="flex-1">System</span>
            {#if themeState.mode === 'system'}<Check size={13} />{/if}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={themeState.mode === 'light'}
            onclick={() => selectTheme('light')}
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            <Sun size={14} class="text-amber-500" />
            <span class="flex-1">Light</span>
            {#if themeState.mode === 'light'}<Check size={13} />{/if}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={themeState.mode === 'dark'}
            onclick={() => selectTheme('dark')}
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            <Moon size={14} class="text-neutral-600 dark:text-neutral-300" />
            <span class="flex-1">Dark</span>
            {#if themeState.mode === 'dark'}<Check size={13} />{/if}
          </button>
        </div>
      {/if}
    </div>

    <!-- Variables Button -->
    <button
      onclick={() => (envState.isVariablesModalOpen = true)}
      title="Configure {envState.activeEnvName} variables & secrets ({isMac ? '⌘E' : 'Ctrl+E'})"
      class="flex items-center gap-1 text-xs bg-white dark:bg-[#252526] hover:bg-neutral-100 dark:hover:bg-[#303030] border border-[#d2d2d7] dark:border-[#383838] rounded-md px-2 py-1 text-neutral-700 dark:text-neutral-300 transition-colors shadow-sm"
    >
      <span class="font-mono font-bold text-blue-600 dark:text-blue-400 text-[11px]">&#123;x&#125;</span>
      <span
        class="max-w-24 truncate text-[11px] font-medium text-neutral-600 dark:text-neutral-300"
        title={`Active environment: ${envState.activeEnvName}`}
      >
        {envState.activeEnvName}
      </span>
      {#if envState.variables.length > 0}
        <span class="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 font-mono">
          {envState.variables.length}
        </span>
      {/if}
    </button>
  </div>
</header>
