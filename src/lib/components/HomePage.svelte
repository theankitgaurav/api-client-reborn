<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { Layers, Plus, Upload } from '$lib/components/icons';
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
        class="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-strong)]"
      >
        <Plus size={15} />
        New request
      </button>
      <button
        type="button"
        onclick={() => workspaceState.openImportModal()}
        class="inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-muted)]"
      >
        <Upload size={15} />
        Import collection
      </button>
    </div>

    <p class="mt-6 text-xs text-[var(--text-subtle)]">
      Or choose an existing request from the workspace sidebar.
    </p>
  </div>
</section>
