<script lang="ts">
  let { size = 14, direction, class: className = '' }: {
    size?: number;
    direction?: 'expand' | 'collapse';
    class?: string;
  } = $props();
</script>
<svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={className}>
  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>
  {#if direction === 'expand'}
    <path d="M12 12h5m-2-2 2 2-2 2"/>
  {:else if direction === 'collapse'}
    <path d="M17 12h-5m2-2-2 2 2 2"/>
  {/if}
</svg>
