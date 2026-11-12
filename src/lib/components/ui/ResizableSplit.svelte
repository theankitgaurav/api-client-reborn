<script lang="ts">
  import type { Snippet } from 'svelte';
  import { uiState } from '$lib/state/ui.svelte';

  interface Props {
    class?: string;
    request?: Snippet;
    response?: Snippet;
  }
  let { class: className = '', request, response }: Props = $props();
</script>

  <div
  data-resizable-workspace
  class="relative flex min-h-0 flex-1 overflow-hidden {className}"
  role="presentation"
>
  <div class="min-w-0" style={`width: ${uiState.splitRatio * 100}%`}>{@render request?.()}</div>
  <input
    type="range"
    min="30"
    max="70"
    step="1"
    value={Math.round(uiState.splitRatio * 100)}
    aria-label="Resize request and response panels"
    oninput={(event) => uiState.setSplitRatio(Number((event.currentTarget as HTMLInputElement).value) / 100)}
    class="ui-resize-handle"
  />
  <div class="min-w-0 flex-1">{@render response?.()}</div>
</div>
