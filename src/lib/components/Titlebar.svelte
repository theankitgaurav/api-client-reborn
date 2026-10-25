<script lang="ts">
  import { envState } from '$lib/state/env.svelte';
  import { responseState } from '$lib/state/response.svelte';
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { themeState } from '$lib/state/theme.svelte';
  import {
    Layers,
    Sun,
    Moon,
  } from '$lib/components/icons';

  function handleSend() {
    if (responseState.isExecuting) {
      responseState.cancel();
    } else {
      responseState.runCurrentRequest();
    }
  }

  // Global keyboard shortcuts
  function handleKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      workspaceState.saveActiveFile();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<header
  data-tauri-drag-region
  class="h-10 bg-[#f0f0f3] dark:bg-[#1e1e1e] border-b border-[#d8d8dc] dark:border-[#2d2d2d] flex items-center justify-between select-none px-3 transition-colors"
>
  <!-- App name at the extreme left, offset past macOS traffic lights -->
  <div class="flex items-center space-x-2 pl-[76px]">
    <span class="text-xs font-semibold text-neutral-700 dark:text-neutral-400 tracking-wide flex items-center gap-1.5">
      <Layers size={14} class="text-blue-500" />
      API Client Reborn
    </span>
    {#if workspaceState.isDirty}
      <span class="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 font-medium">
        Unsaved
      </span>
    {/if}
  </div>

  <!-- Right: Theme Switcher & Variables Action -->
  <div class="flex items-center space-x-2">
    <!-- Light/Dark Toggle -->
    <button
      onclick={() => themeState.toggle()}
      title="Switch to {themeState.isDark() ? 'Light' : 'Dark'} Theme"
      class="p-1.5 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-neutral-800 rounded transition-colors"
    >
      {#if themeState.isDark()}
        <Sun size={14} class="text-amber-400" />
      {:else}
        <Moon size={14} class="text-neutral-600" />
      {/if}
    </button>

    <!-- Variables Button -->
    <button
      onclick={() => (envState.isVariablesModalOpen = true)}
      title="Configure Workspace Variables & Secrets"
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
