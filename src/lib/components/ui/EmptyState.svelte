<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props {
    title: string;
    description?: string;
    children?: Snippet;
  }
  let { title, description, children }: Props = $props();
</script>

<div class="flex h-full flex-col items-center justify-center px-6 text-center">
  <div class="text-[12px] font-medium text-[var(--text-subtle)]">{title}</div>
  {#if description}<div class="mt-1 max-w-xs text-[11px] text-[var(--text-muted)]">{description}</div>{/if}
  {@render children?.()}
</div>
