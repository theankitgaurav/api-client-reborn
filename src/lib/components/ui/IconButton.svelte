<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props {
    label: string;
    title?: string;
    size?: number;
    class?: string;
    onclick?: (event: MouseEvent) => void;
    children?: Snippet<[number]>;
  }
  let {
    label,
    title = label,
    size = 14,
    class: className = '',
    onclick,
    children,
  }: Props = $props();
</script>

<button
  type="button"
  aria-label={label}
  {title}
  onclick={onclick}
  class="ui-icon-button {className}"
>
  {@render children?.(size)}
</button>
