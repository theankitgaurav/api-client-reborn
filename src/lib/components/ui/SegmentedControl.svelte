<script lang="ts">
  export interface SegmentItem {
    id: string;
    label: string;
    count?: number;
    badge?: string;
  }

  interface Props {
    items: SegmentItem[];
    activeId: string;
    size?: 'sm' | 'md';
    class?: string;
    onchange?: (id: string) => void;
  }

  let {
    items,
    activeId = $bindable(),
    size = 'sm',
    class: className = '',
    onchange,
  }: Props = $props();

  function select(id: string) {
    activeId = id;
    onchange?.(id);
  }
</script>

<div
  role="tablist"
  class="inline-flex items-center gap-0.5 rounded-md p-0.5 bg-[var(--surface-hover)] border border-[var(--border)] select-none {className}"
>
  {#each items as item (item.id)}
    {@const isActive = item.id === activeId}
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onclick={() => select(item.id)}
      class="inline-flex items-center gap-1.5 rounded font-medium transition-all duration-100 {size === 'sm'
        ? 'px-2 py-0.5 text-[11px]'
        : 'px-2.5 py-1 text-xs'} {isActive
        ? 'bg-[var(--surface)] text-[var(--text-strong)] shadow-sm font-semibold'
        : 'text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:bg-[var(--surface)]/50'}"
    >
      <span>{item.label}</span>
      {#if item.count !== undefined && item.count > 0}
        <span
          class="rounded-full px-1 py-0.2 font-mono text-[9px] font-bold leading-tight {isActive
            ? 'bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)]'
            : 'bg-[var(--border)] text-[var(--text-muted)]'}"
        >
          {item.count}
        </span>
      {:else if item.badge}
        <span
          class="rounded px-1 py-0.2 font-mono text-[9px] font-semibold leading-tight {isActive
            ? 'bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)]'
            : 'bg-[var(--border)] text-[var(--text-muted)]'}"
        >
          {item.badge}
        </span>
      {/if}
    </button>
  {/each}
</div>
