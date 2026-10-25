<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { Save, AlertCircle, Clock, Tag } from 'lucide-svelte';

  let rawContent = $derived(workspaceState.activeFile?.raw_content || '');
  let meta = $derived(workspaceState.activeFile?.metadata);

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    workspaceState.updateContent(target.value);
  }
</script>

<div class="flex-1 flex flex-col h-full bg-[#1e1e1e] border-r border-[#2d2d2d] overflow-hidden">
  <!-- Metadata Header Chips -->
  <div class="px-3 py-2 bg-[#252526] border-b border-[#2d2d2d] flex items-center justify-between text-xs">
    <div class="flex items-center gap-2 overflow-x-auto">
      <span class="font-medium text-neutral-200">
        {meta?.name || 'Untitled Request'}
      </span>
      {#if meta?.timeout_ms}
        <span class="flex items-center gap-1 text-[11px] text-neutral-400 bg-[#1e1e1e] px-1.5 py-0.5 rounded border border-[#333]">
          <Clock size={11} class="text-neutral-500" />
          {meta.timeout_ms}ms
        </span>
      {/if}
      {#if meta?.tags && meta.tags.length > 0}
        {#each meta.tags as tag}
          <span class="flex items-center gap-1 text-[11px] text-blue-300 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
            <Tag size={10} />
            {tag}
          </span>
        {/each}
      {/if}
    </div>

    <div class="flex items-center gap-2">
      {#if workspaceState.isDirty}
        <button
          onclick={() => workspaceState.saveActiveFile()}
          class="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-0.5 rounded transition-colors"
        >
          <Save size={12} />
          <span>Save (⌘S)</span>
        </button>
      {/if}
    </div>
  </div>

  <!-- Raw Command Editor -->
  <div class="flex-1 relative flex overflow-hidden">
    {#if workspaceState.activeFile}
      <textarea
        value={rawContent}
        oninput={handleInput}
        spellcheck="false"
        placeholder="# @name My Request\n\ncurl -X GET 'https://api.example.com'"
        class="w-full h-full bg-[#1e1e1e] text-neutral-200 font-mono text-[13px] leading-relaxed p-4 resize-none outline-none border-none selection:bg-blue-600/30"
      ></textarea>
    {:else}
      <div class="m-auto text-neutral-500 text-xs">
        Select a request from the sidebar to inspect or execute
      </div>
    {/if}
  </div>

  <!-- Command Helper Footer -->
  <div class="px-3 py-1 bg-[#181818] border-t border-[#2d2d2d] flex items-center justify-between text-[11px] text-neutral-500">
    <div class="flex items-center gap-3">
      <span>cURL Command File (.curl)</span>
      <span>Variables: <code class="text-neutral-400">{"{{var}}"}</code></span>
    </div>
    <div>UTF-8</div>
  </div>
</div>
