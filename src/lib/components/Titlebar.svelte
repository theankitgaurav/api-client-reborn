<script lang="ts">
  import { envState } from '$lib/state/env.svelte';
  import { responseState } from '$lib/state/response.svelte';
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { Play, Square, KeyRound, Layers } from 'lucide-svelte';

  function handleSend() {
    if (responseState.isExecuting) {
      responseState.cancel();
    } else {
      responseState.runCurrentRequest();
    }
  }

  // Global keyboard shortcut: Cmd+Enter (Mac) or Ctrl+Enter (Win/Linux)
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
  class="h-10 bg-[#1e1e1e] border-b border-[#2d2d2d] flex items-center justify-between select-none px-3"
>
  <!-- macOS traffic lights offset -->
  <div class="flex items-center space-x-2 pl-[70px]">
    <span class="text-xs font-semibold text-neutral-400 tracking-wide flex items-center gap-1.5">
      <Layers size={14} class="text-blue-400" />
      API Client Reborn
    </span>
    {#if workspaceState.isDirty}
      <span class="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">
        Unsaved
      </span>
    {/if}
  </div>

  <!-- Center: Environments & Secrets Picker -->
  <div class="flex items-center space-x-2">
    <div class="flex items-center bg-[#252526] border border-[#383838] rounded-md px-2 py-1 text-xs">
      <span class="text-neutral-400 mr-1.5 font-medium">Env:</span>
      <select
        bind:value={envState.activeEnvName}
        class="bg-transparent text-neutral-200 outline-none cursor-pointer pr-1"
      >
        {#each envState.environments as env}
          <option value={env.name} class="bg-[#252526] text-neutral-200">
            {env.name}
          </option>
        {/each}
        {#if envState.environments.length === 0}
          <option value="development" class="bg-[#252526] text-neutral-200">development</option>
        {/if}
      </select>
    </div>

    <!-- Secrets Manager Trigger -->
    <button
      onclick={() => (envState.isSecretsModalOpen = true)}
      title="Manage Local Secrets (.secrets.env)"
      class="flex items-center gap-1 text-xs bg-[#252526] hover:bg-[#303030] border border-[#383838] rounded-md px-2 py-1 text-neutral-300 transition-colors"
    >
      <KeyRound size={13} class="text-amber-400" />
      <span class="text-[11px]">Secrets</span>
    </button>
  </div>

  <!-- Right: Send / Cancel Action -->
  <div class="flex items-center space-x-2">
    <button
      onclick={handleSend}
      class="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all shadow-sm {responseState.isExecuting
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
