<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    class?: string;
    children?: Snippet;
  }
  let { class: className = '', children }: Props = $props();
</script>

<kbd
  class="inline-flex items-center justify-center rounded px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-[var(--text-muted)] bg-[var(--surface-hover)] border border-[var(--border)] select-none {className}"
>
  {@render children?.()}
</kbd>
