<script lang="ts">
  import type { Snippet } from 'svelte';
  type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
  type Size = 'sm' | 'md';
  interface Props {
    variant?: Variant;
    size?: Size;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    class?: string;
    title?: string;
    onclick?: (event: MouseEvent) => void;
    children?: Snippet;
  }
  let {
    variant = 'secondary',
    size = 'sm',
    type = 'button',
    disabled = false,
    class: className = '',
    title,
    onclick,
    children,
  }: Props = $props();

  const variants: Record<Variant, string> = {
    primary: 'ui-button-primary',
    secondary: 'ui-button-secondary',
    ghost: 'ui-button-ghost',
    danger: 'ui-button-danger',
  };
</script>

<button
  {type}
  {disabled}
  {title}
  onclick={onclick}
  class="ui-button {variants[variant]} {size === 'md' ? 'h-8 px-3' : 'h-7 px-2.5'} {className}"
>
  {@render children?.()}
</button>
