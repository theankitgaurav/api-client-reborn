<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props {
    title: string;
    subtitle?: string;
    class?: string;
    leading?: Snippet;
    actions?: Snippet;
  }
  let { title, subtitle, class: className = '', leading, actions }: Props = $props();
</script>

<div class="ui-panel-header {className}">
  <div class="flex min-w-0 items-center gap-2">
    {@render leading?.()}
    <div class="min-w-0">
      <div class="truncate text-[12px] font-semibold text-[var(--text-strong)]">{title}</div>
      {#if subtitle}<div class="truncate text-[10px] text-[var(--text-muted)]">{subtitle}</div>{/if}
    </div>
  </div>
  {@render actions?.()}
</div>
