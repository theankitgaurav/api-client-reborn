<script lang="ts">
  import type { Snippet } from 'svelte';
  import { uiState } from '$lib/state/ui.svelte';

  interface Props {
    class?: string;
    request?: Snippet;
    response?: Snippet;
  }
  let { class: className = '', request, response }: Props = $props();
  let container: HTMLDivElement;
  let isDragging = $state(false);

  function updateSplit(clientX: number) {
    const bounds = container.getBoundingClientRect();
    if (bounds.width <= 0) return;
    uiState.setSplitRatio((clientX - bounds.left) / bounds.width);
  }

  function startDragging(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    isDragging = true;
    updateSplit(event.clientX);
  }

  function stopDragging() {
    isDragging = false;
  }

  function handleResizeKeydown(event: KeyboardEvent) {
    const increment = event.shiftKey ? 0.05 : 0.01;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      uiState.setSplitRatio(uiState.splitRatio - increment);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      uiState.setSplitRatio(uiState.splitRatio + increment);
    } else if (event.key === 'Home') {
      event.preventDefault();
      uiState.setSplitRatio(0.3);
    } else if (event.key === 'End') {
      event.preventDefault();
      uiState.setSplitRatio(0.7);
    }
  }
</script>

<div
  bind:this={container}
  data-resizable-workspace
  class="relative grid min-h-0 flex-1 overflow-hidden {className}"
  style={`grid-template-columns: minmax(0, ${uiState.splitRatio}fr) 6px minmax(0, ${1 - uiState.splitRatio}fr)`}
  role="presentation"
>
  <div class="min-h-0 min-w-0 overflow-hidden">{@render request?.()}</div>
  <div
    role="slider"
    aria-orientation="vertical"
    aria-label="Resize request and response panels"
    aria-valuemin={30}
    aria-valuemax={70}
    aria-valuenow={Math.round(uiState.splitRatio * 100)}
    aria-valuetext="{Math.round(uiState.splitRatio * 100)}% request panel"
    tabindex="0"
    onpointerdown={startDragging}
    onpointermove={(event) => isDragging && updateSplit(event.clientX)}
    onpointerup={stopDragging}
    onpointercancel={stopDragging}
    onkeydown={handleResizeKeydown}
    class="ui-resize-handle {isDragging ? 'is-dragging' : ''}"
  ></div>
  <div class="min-h-0 min-w-0 overflow-hidden">{@render response?.()}</div>
</div>
