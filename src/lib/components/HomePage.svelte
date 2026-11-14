<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { FileCode, Layers, Plus, Upload } from '$lib/components/icons';
  import Kbd from '$lib/components/ui/Kbd.svelte';
</script>

<section class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-[var(--bg)] px-6 py-10">
  <div class="w-full max-w-3xl">
    <div class="flex items-center gap-2 text-xs font-medium text-[var(--accent)]">
      <Layers size={14} />
      <span>LOCAL API WORKSPACE</span>
    </div>
    <h1 class="mt-4 text-2xl font-semibold tracking-tight text-[var(--text-strong)]">Start with a request.</h1>
    <p class="mt-2 max-w-xl text-sm leading-relaxed text-[var(--text-muted)]">
      Build HTTP or gRPC calls, keep them as readable files, and inspect responses beside the editor.
    </p>

    <div class="mt-7 grid gap-2 sm:grid-cols-3">
      <button
        type="button"
        onclick={() => workspaceState.createNewRequest()}
        class="flex min-h-20 items-center gap-3 rounded-md border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))] px-4 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_15%,var(--surface))]"
      >
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] text-[var(--accent)]">
          <Plus size={16} />
        </span>
        <span class="flex flex-col gap-1">
          <span class="text-sm font-semibold text-[var(--text-strong)]">HTTP request</span>
          <span class="text-xs text-[var(--text-muted)]">Compose and send</span>
        </span>
      </button>
      <button
        type="button"
        onclick={() => workspaceState.createNewGrpcRequest()}
        class="flex min-h-20 items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
      >
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)]">
          <FileCode size={16} />
        </span>
        <span class="flex flex-col gap-1">
          <span class="text-sm font-semibold text-[var(--text-strong)]">gRPC request</span>
          <span class="text-xs text-[var(--text-muted)]">Call a service method</span>
        </span>
      </button>
      <button
        type="button"
        onclick={() => workspaceState.openImportModal()}
        class="flex min-h-20 items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
      >
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)]">
          <Upload size={16} />
        </span>
        <span class="flex flex-col gap-1">
          <span class="text-sm font-semibold text-[var(--text-strong)]">Import collection</span>
          <span class="text-xs text-[var(--text-muted)]">Bring existing requests</span>
        </span>
      </button>
    </div>

    <div class="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border-subtle)] pt-4 text-xs text-[var(--text-muted)]">
      <span class="flex items-center gap-1.5"><Kbd>⌘N</Kbd> New request</span>
      <span class="flex items-center gap-1.5"><Kbd>⌘K</Kbd> Command palette</span>
    </div>
  </div>
</section>
