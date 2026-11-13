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
  import Kbd from '$lib/components/ui/Kbd.svelte';
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
    Search,
  } from '$lib/components/icons';

  let isMac = $derived(shortcutsState.isMac);
  let effectiveThemeIsDark = $derived(themeState.isDark());
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

  function closeMenuOutside(event: MouseEvent) {
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

<svelte:window onclick={closeMenuOutside} />

<header
  data-tauri-drag-region
  class="flex h-9 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-3 select-none text-xs"
>
  <!-- Left: Traffic Lights Offset & Workspace Selector -->
  <div class="flex items-center gap-2 {isMac ? 'pl-[70px]' : 'pl-1'}">
    <button
      type="button"
      onclick={() => updaterState.checkForUpdates({ manual: true })}
      title="API Client Reborn v{updaterState.currentVersion} • Check for updates"
      class="flex items-center gap-1.5 text-[11px] font-semibold tracking-tight text-[var(--text-strong)] transition-colors hover:text-[var(--accent)]"
    >
      <Layers size={13} class="text-[var(--accent)]" />
      <span>API Client Reborn</span>
    </button>

    <div class="h-3 w-px bg-[var(--border)]"></div>

    <div class="relative" data-workspace-picker>
      <button
        type="button"
        onclick={toggleWorkspaceMenu}
        title="Current workspace: {workspaceState.workspacePath}"
        aria-label="Workspace: {workspaceName}. Choose workspace"
        aria-haspopup="menu"
        aria-expanded={isWorkspaceMenuOpen}
        disabled={isSwitchingWorkspace}
        class="flex max-w-44 items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-60"
      >
        <FolderOpen size={12} class="shrink-0 text-[var(--accent)]" />
        <span class="truncate">{workspaceName}</span>
        <span aria-hidden="true" class="shrink-0 text-[9px] opacity-60">▾</span>
      </button>

      {#if isWorkspaceMenuOpen}
        <div
          role="menu"
          aria-label="Workspace options"
          class="ui-menu-surface absolute left-0 top-full z-[100] mt-1.5 w-72 text-[11px]"
        >
          <div class="border-b border-[var(--border)] px-2.5 py-1.5">
            <div class="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">Current Workspace</div>
            <div class="mt-0.5 break-all text-[11px] font-mono text-[var(--text-muted)]">{workspaceState.workspacePath}</div>
          </div>
          <div class="max-h-56 overflow-y-auto py-1">
            {#if isLoadingWorkspaceHistory}
              <p class="px-2.5 py-2 text-[11px] text-[var(--text-muted)]">Loading workspaces…</p>
            {:else}
              {#each workspaceOptions as path, index}
                <button
                  type="button"
                  role="menuitem"
                  disabled={isSwitchingWorkspace}
                  title={path}
                  aria-label="Switch to {getWorkspaceName(path)}{index === 0 ? ', default workspace' : ''}"
                  onclick={() => switchToWorkspace(path)}
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50 {path === workspaceState.workspacePath ? 'bg-[var(--surface-hover)] font-medium text-[var(--text-strong)]' : 'text-[var(--text)]'}"
                >
                  <FolderOpen size={13} class="shrink-0 text-[var(--accent)]" />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate">{getWorkspaceName(path)}</span>
                    <span class="truncate font-mono text-[9px] text-[var(--text-subtle)]">{path}</span>
                  </span>
                  {#if index === 0}
                    <span class="shrink-0 rounded bg-[var(--surface-muted)] border border-[var(--border)] px-1 py-0.2 text-[9px] text-[var(--text-muted)]">Default</span>
                  {/if}
                  {#if path === workspaceState.workspacePath}
                    <Check size={12} class="shrink-0 text-[var(--accent)]" />
                  {/if}
                </button>
              {/each}
            {/if}
          </div>
          {#if workspaceState.workspaceError || workspaceMenuError}
            <p role="alert" class="px-2.5 py-1.5 text-[10px] text-[var(--danger)] border-t border-[var(--border)]">{workspaceMenuError || workspaceState.workspaceError}</p>
          {/if}
          <div class="border-t border-[var(--border)] pt-1">
            <button
              type="button"
              role="menuitem"
              disabled={isSwitchingWorkspace}
              onclick={chooseWorkspace}
              class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50 text-[var(--text-strong)]"
            >
              <FolderOpen size={13} class="text-[var(--text-muted)]" />
              <span>{isSwitchingWorkspace ? 'Opening workspace…' : 'Choose Workspace…'}</span>
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Center: Search Trigger (Command Palette) -->
  <div class="flex items-center">
    <button
      type="button"
      onclick={() => uiState.openCommandPalette()}
      title="Search and commands ({isMac ? '⌘K' : 'Ctrl+K'})"
      class="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-all select-none"
    >
      <Search size={11} class="text-[var(--text-subtle)]" />
      <span class="font-normal">Search or command…</span>
      <Kbd class="ml-1 text-[9px]">{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
    </button>
  </div>

  <!-- Right: Actions (Update, MCP, Shortcuts, Theme, Env Vars) -->
  <div class="flex items-center gap-1.5">
    {#if updaterState.hasUpdateNotification}
      <button
        onclick={() => updaterState.openModal()}
        title="Update v{updaterState.availableVersion} is available"
        class="flex items-center gap-1 rounded bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] transition-colors"
      >
        <Download size={11} />
        <span>v{updaterState.availableVersion}</span>
      </button>
    {/if}

    <!-- MCP AI Integration Button -->
    <button
      onclick={() => (workspaceState.isMcpModalOpen = true)}
      title="AI & Model Context Protocol (MCP)"
      aria-label="MCP Integration"
      class="ui-icon-button"
    >
      <Bot size={13} />
    </button>

    <!-- Keyboard Shortcuts Button -->
    <button
      onclick={() => shortcutsState.toggleCheatSheet()}
      title="Keyboard Shortcuts ({isMac ? '⌘/' : 'Ctrl+/'})"
      aria-label="Keyboard Shortcuts"
      class="ui-icon-button"
    >
      <Keyboard size={13} />
    </button>

    <!-- Theme Picker -->
    <div class="relative" data-theme-picker>
      <button
        type="button"
        onclick={() => (isThemeMenuOpen = !isThemeMenuOpen)}
        title="Theme: {themeState.mode} ({effectiveThemeIsDark ? 'dark' : 'light'})"
        aria-label="Choose theme"
        aria-haspopup="menu"
        aria-expanded={isThemeMenuOpen}
        class="ui-icon-button"
      >
        {#if effectiveThemeIsDark}
          <Moon size={13} />
        {:else}
          <Sun size={13} />
        {/if}
      </button>

      {#if isThemeMenuOpen}
        <div
          role="menu"
          aria-label="Choose theme"
          class="ui-menu-surface absolute right-0 top-full z-50 mt-1.5 w-36 text-[11px]"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={themeState.mode === 'system'}
            onclick={() => selectTheme('system')}
            class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-[var(--surface-hover)] transition-colors text-[var(--text)]"
          >
            <Monitor size={12} class="text-[var(--text-muted)]" />
            <span class="flex-1">System</span>
            {#if themeState.mode === 'system'}<Check size={12} class="text-[var(--accent)]" />{/if}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={themeState.mode === 'light'}
            onclick={() => selectTheme('light')}
            class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-[var(--surface-hover)] transition-colors text-[var(--text)]"
          >
            <Sun size={12} class="text-[var(--text-muted)]" />
            <span class="flex-1">Light</span>
            {#if themeState.mode === 'light'}<Check size={12} class="text-[var(--accent)]" />{/if}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={themeState.mode === 'dark'}
            onclick={() => selectTheme('dark')}
            class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-[var(--surface-hover)] transition-colors text-[var(--text)]"
          >
            <Moon size={12} class="text-[var(--text-muted)]" />
            <span class="flex-1">Dark</span>
            {#if themeState.mode === 'dark'}<Check size={12} class="text-[var(--accent)]" />{/if}
          </button>
        </div>
      {/if}
    </div>

    <!-- Environment Variables Button -->
    <button
      onclick={() => (envState.isVariablesModalOpen = true)}
      title="Environment variables ({isMac ? '⌘E' : 'Ctrl+E'})"
      aria-label="Configure environment variables"
      class="flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-muted)] hover:bg-[var(--surface-hover)] px-2 py-1 text-[11px] font-medium text-[var(--text-strong)] transition-colors select-none"
    >
      <span class="font-mono text-[10px] font-bold text-[var(--accent)] leading-none">&#123;x&#125;</span>
      <span class="truncate max-w-28 text-[11px] text-[var(--text)]">{envState.activeEnvName}</span>
      {#if envState.variables.length > 0}
        <span class="rounded bg-[var(--border)] px-1 py-0.2 font-mono text-[9px] font-semibold text-[var(--text-muted)] leading-none">
          {envState.variables.length}
        </span>
      {/if}
    </button>
  </div>
</header>
