<script lang="ts">
  import { envState } from '$lib/state/env.svelte';
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { themeState } from '$lib/state/theme.svelte';
  import { shortcutsState } from '$lib/state/shortcuts.svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import {
    Layers,
    Sun,
    Moon,
    Monitor,
    Check,
    Keyboard,
  } from '$lib/components/icons';

  let isMac = $derived(shortcutsState.isMac);
  let isAboutOpen = $state(false);
  let appVersion = $state('');
  let isThemeMenuOpen = $state(false);

  async function openAbout() {
    isAboutOpen = true;
    try {
      appVersion = await getVersion();
    } catch {
      appVersion = 'Development';
    }
  }

  function closeAbout() {
    isAboutOpen = false;
  }

  function handleAboutKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeAbout();
  }

  function closeThemeMenuOutside(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('[data-theme-picker]')) {
      isThemeMenuOpen = false;
    }
  }

  function selectTheme(mode: 'system' | 'light' | 'dark') {
    themeState.setMode(mode);
    isThemeMenuOpen = false;
  }
</script>

<svelte:window onkeydown={handleAboutKeydown} onclick={closeThemeMenuOutside} />

<header
  data-tauri-drag-region
  class="h-10 bg-[#f0f0f3] dark:bg-[#1e1e1e] border-b border-[#d8d8dc] dark:border-[#2d2d2d] flex items-center justify-between select-none px-3 transition-colors"
>
  <!-- App name at the extreme left, offset past macOS traffic lights -->
  <div class="flex items-center space-x-2 pl-[76px]">
    <button
      type="button"
      onclick={openAbout}
      title="About API Client Reborn"
      class="text-xs font-semibold text-neutral-700 dark:text-neutral-400 tracking-wide flex items-center gap-1.5 hover:text-neutral-950 dark:hover:text-white transition-colors"
    >
      <Layers size={14} class="text-blue-500" />
      API Client Reborn
    </button>
    {#if workspaceState.isDirty}
      <span class="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 font-medium">
        Unsaved
      </span>
    {/if}
  </div>

  <!-- Right: Theme Switcher & Variables Action -->
  <div class="flex items-center space-x-2">
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
      title="Configure Workspace Variables & Secrets ({isMac ? '⌘E' : 'Ctrl+E'})"
      class="flex items-center gap-1.5 text-xs bg-white dark:bg-[#252526] hover:bg-neutral-100 dark:hover:bg-[#303030] border border-[#d2d2d7] dark:border-[#383838] rounded-md px-2.5 py-1 text-neutral-700 dark:text-neutral-300 transition-colors shadow-sm"
    >
      <span class="font-mono font-bold text-blue-600 dark:text-blue-400 text-[11px]">&#123;x&#125;</span>
      <span class="font-medium text-[11px]">Variables</span>
      {#if envState.variables.length > 0}
        <span class="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 font-mono">
          {envState.variables.length}
        </span>
      {/if}
    </button>
  </div>
</header>

{#if isAboutOpen}
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
    role="presentation"
    onclick={(event) => event.target === event.currentTarget && closeAbout()}
  >
    <dialog
      open
      aria-modal="true"
      aria-labelledby="about-title"
      class="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 text-neutral-800 shadow-2xl dark:border-[#383838] dark:bg-[#252526] dark:text-neutral-100"
    >
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 id="about-title" class="text-base font-semibold">API Client Reborn</h2>
          <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Version {appVersion || '…'}</p>
        </div>
        <button
          type="button"
          onclick={closeAbout}
          aria-label="Close About dialog"
          class="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-700 dark:hover:text-white"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p class="mt-5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
        Built with ❤️ by Ankit Gaurav for developers who love speed, simplicity, and open protocols.
      </p>
    </dialog>
  </div>
{/if}
