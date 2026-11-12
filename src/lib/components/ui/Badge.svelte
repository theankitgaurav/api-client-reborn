<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props {
    tone?: 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'cyan';
    class?: string;
    children?: Snippet;
  }
  let { tone = 'neutral', class: className = '', children }: Props = $props();
</script>

<span class="ui-badge ui-badge-{tone} {className}">{@render children?.()}</span>
