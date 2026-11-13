<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { Layers, Plus, Upload } from '$lib/components/icons';
  import Kbd from '$lib/components/ui/Kbd.svelte';
</script>

<section class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-[var(--bg)] px-6 py-10">
  <div class="flex w-full max-w-lg flex-col items-center text-center">
    <div class="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--accent)] shadow-sm">
      <Layers size={26} />
    </div>
    <h1 class="text-xl font-semibold tracking-tight text-[var(--text-strong)]">Welcome to API Client Reborn</h1>
    <p class="mt-2 max-w-md text-sm leading-relaxed text-[var(--text-muted)]">
      Create a request to get started, or import a collection to bring your existing API work with you.
    </p>

    <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
      <button
        type="button"
        onclick={() => workspaceState.createNewRequest()}
        class="ui-button ui-button-primary inline-flex items-center gap-2 px-4 py-2 text-xs"
      >
        <Plus size={15} />
        New request
      </button>
      <button
        type="button"
        onclick={() => workspaceState.openImportModal()}
        class="ui-button ui-button-secondary inline-flex items-center gap-2 px-4 py-2 text-xs"
      >
        <Upload size={15} />
        Import collection
      </button>
    </div>

    <div class="mt-8 flex items-center gap-4 text-[11px] text-[var(--text-subtle)]">
      <span class="flex items-center gap-1.5"><Kbd>⌘N</Kbd> New request</span>
      <span class="text-[var(--border-strong)]">·</span>
      <span class="flex items-center gap-1.5"><Kbd>⌘K</Kbd> Command palette</span>
    </div>
  </div>
</section>
