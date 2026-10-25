<script lang="ts">
  import { envState } from '$lib/state/env.svelte';
  import { responseState } from '$lib/state/response.svelte';
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { themeState } from '$lib/state/theme.svelte';
  import {
    Play,
    Square,
    KeyRound,
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
  <!-- macOS traffic lights offset -->
  <div class="flex items-center space-x-2 pl-[70px]">
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

  <!-- Center: Environments & Secrets Picker -->
  <div class="flex items-center space-x-2">
    <div class="flex items-center bg-white dark:bg-[#252526] border border-[#d2d2d7] dark:border-[#383838] rounded-md px-2 py-1 text-xs shadow-sm">
      <span class="text-neutral-500 dark:text-neutral-400 mr-1.5 font-medium">Env:</span>
      <select
        bind:value={envState.activeEnvName}
        class="bg-transparent text-neutral-800 dark:text-neutral-200 outline-none cursor-pointer pr-1"
      >
        {#each envState.environments as env}
          <option value={env.name} class="bg-white dark:bg-[#252526] text-neutral-800 dark:text-neutral-200">
            {env.name}
          </option>
        {/each}
        {#if envState.environments.length === 0}
          <option value="development" class="bg-white dark:bg-[#252526] text-neutral-800 dark:text-neutral-200">development</option>
        {/if}
      </select>
    </div>

    <!-- Secrets Manager Trigger -->
    <button
      onclick={() => (envState.isSecretsModalOpen = true)}
      title="Manage Local Secrets (.secrets.env)"
      class="flex items-center gap-1 text-xs bg-white dark:bg-[#252526] hover:bg-neutral-100 dark:hover:bg-[#303030] border border-[#d2d2d7] dark:border-[#383838] rounded-md px-2 py-1 text-neutral-700 dark:text-neutral-300 transition-colors shadow-sm"
    >
      <KeyRound size={13} class="text-amber-500" />
      <span class="text-[11px] font-medium">Secrets</span>
    </button>
  </div>

  <!-- Right: Theme Switcher & Send / Cancel Action -->
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

    <button
      onclick={handleSend}
      class="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-all shadow-sm {responseState.isExecuting
        ? 'bg-rose-600 hover:bg-rose-700 text-white'
        : 'bg-blue-600 hover:bg-blue-500 text-white active:scale-95'}"
    >
      {#if responseState.isExecuting}
        <Square size={13} fill="currentColor" />
        <span>Cancel</span>
      {:else}
        <Play size={13} fill="currentColor" />
        <span>Send</span>
        <span class="text-[10px] opacity-75 ml-0.5 font-mono">⌘↵</span>
      {/if}
    </button>
  </div>
</header>
