<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X } from '$lib/components/icons';

  interface Props {
    isOpen: boolean;
    title: string;
    description?: string;
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
    onclose: () => void;
    icon?: Snippet;
    headerActions?: Snippet;
    children?: Snippet;
    footer?: Snippet;
  }

  let {
    isOpen,
    title,
    description,
    maxWidth = 'md',
    onclose,
    icon,
    headerActions,
    children,
    footer,
  }: Props = $props();

  const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  };

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={isOpen ? handleKeydown : undefined} />

{#if isOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[1px] select-none"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && onclose()}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      class="flex flex-col w-full {maxWidthClasses[maxWidth]} max-h-[85vh] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text)] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
    >
      <!-- Modal Header -->
      <div class="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5">
        <div class="flex items-center gap-2 min-w-0">
          {#if icon}
            <div class="shrink-0 text-[var(--accent)]">
              {@render icon()}
            </div>
          {/if}
          <div class="min-w-0">
            <h2 id="modal-title" class="truncate text-xs font-semibold text-[var(--text-strong)]">
              {title}
            </h2>
            {#if description}
              <p class="truncate text-[10px] text-[var(--text-muted)]">
                {description}
              </p>
            {/if}
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0 ml-2">
          {#if headerActions}
            {@render headerActions()}
          {/if}
          <button
            type="button"
            onclick={onclose}
            aria-label="Close dialog"
            class="ui-icon-button"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <!-- Modal Body -->
      <div class="flex-1 overflow-y-auto min-h-0 bg-[var(--surface)]">
        {@render children?.()}
      </div>

      <!-- Modal Footer -->
      {#if footer}
        <div class="flex items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}
