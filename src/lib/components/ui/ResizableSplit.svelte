<script lang="ts">
  import type { Snippet } from 'svelte';
  import { uiState } from '$lib/state/ui.svelte';

  interface Props {
    class?: string;
    request?: Snippet;
    response?: Snippet;
    wideRequestToolbar?: boolean;
  }
  let { class: className = '', request, response, wideRequestToolbar = true }: Props = $props();
  let container: HTMLDivElement;
  let isDragging = $state(false);

  function updateSplit(event: PointerEvent) {
    const bounds = container.getBoundingClientRect();
    if (uiState.splitOrientation === 'vertical') {
      if (bounds.width <= 0) return;
      uiState.setSplitRatio((event.clientX - bounds.left) / bounds.width);
    } else {
      if (bounds.height <= 0) return;
      uiState.setSplitRatio((event.clientY - bounds.top) / bounds.height);
    }
  }

  function startDragging(event: PointerEvent) {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    isDragging = true;
    updateSplit(event);
  }

  function stopDragging() {
    isDragging = false;
  }

  function handleResizeKeydown(event: KeyboardEvent) {
    const increment = event.shiftKey ? 0.05 : 0.01;
    if (uiState.splitOrientation === 'vertical' && event.key === 'ArrowLeft') {
      event.preventDefault();
      uiState.setSplitRatio(uiState.splitRatio - increment);
    } else if (uiState.splitOrientation === 'vertical' && event.key === 'ArrowRight') {
      event.preventDefault();
      uiState.setSplitRatio(uiState.splitRatio + increment);
    } else if (uiState.splitOrientation === 'horizontal' && event.key === 'ArrowUp') {
      event.preventDefault();
      uiState.setSplitRatio(uiState.splitRatio - increment);
    } else if (uiState.splitOrientation === 'horizontal' && event.key === 'ArrowDown') {
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

{#snippet resizeHandle(placement: string)}
  <div class="group relative z-10" style={placement}>
    <div
      role="slider"
      aria-orientation={uiState.splitOrientation}
      aria-label="Resize request and response panels"
      aria-valuemin={30}
      aria-valuemax={70}
      aria-valuenow={Math.round(uiState.splitRatio * 100)}
      aria-valuetext="{Math.round(uiState.splitRatio * 100)}% request panel {uiState.splitOrientation === 'vertical' ? 'width' : 'height'}"
      tabindex="0"
      onpointerdown={startDragging}
      onpointermove={(event) => isDragging && updateSplit(event)}
      onpointerup={stopDragging}
      onpointercancel={stopDragging}
      ondblclick={() => uiState.resetSplitRatio()}
      title="Double-click to reset split"
      onkeydown={handleResizeKeydown}
      class="ui-resize-handle absolute inset-0 {isDragging ? 'is-dragging' : ''}"
    ></div>
    <button
      type="button"
      aria-label={uiState.splitOrientation === 'vertical' ? 'Stack request above response' : 'Show request and response side by side'}
      title={uiState.splitOrientation === 'vertical' ? 'Stack request above response' : 'Show request and response side by side'}
      onclick={() => uiState.toggleSplitOrientation()}
      class="pointer-events-none absolute left-1/2 top-1/2 z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] opacity-0 shadow-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:text-[var(--text-strong)] focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        {#if uiState.splitOrientation === 'vertical'}
          <path d="M3 12h18" />
        {:else}
          <path d="M12 3v18" />
        {/if}
      </svg>
    </button>
  </div>
{/snippet}

<div
  bind:this={container}
  data-resizable-workspace
  class="relative grid min-h-0 flex-1 overflow-hidden {className}"
  style={uiState.splitOrientation === 'vertical'
    ? `grid-template-columns: minmax(0, ${uiState.splitRatio}fr) 6px minmax(0, ${1 - uiState.splitRatio}fr); grid-template-rows: ${wideRequestToolbar ? 'auto auto minmax(0, 1fr)' : 'minmax(0, 1fr)'}`
    : `grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, ${uiState.splitRatio}fr) 6px minmax(0, ${1 - uiState.splitRatio}fr)`}
  role="presentation"
>
  {#if uiState.splitOrientation === 'horizontal'}
    <div
      class="grid min-h-0 min-w-0 overflow-hidden"
      style="grid-column: 1; grid-row: 1; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: auto auto minmax(0, 1fr)"
    >
      {@render request?.()}
    </div>
    {@render resizeHandle('grid-column: 1; grid-row: 2')}
    <div
      class="grid min-h-0 min-w-0 overflow-hidden"
      style="grid-column: 1; grid-row: 3; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: auto minmax(0, 1fr)"
    >
      {@render response?.()}
    </div>
  {:else if wideRequestToolbar}
    <div class="contents">{@render request?.()}</div>
    {@render resizeHandle('grid-column: 2; grid-row: 2 / 4')}
    <div class="contents">{@render response?.()}</div>
  {:else}
    <div class="min-h-0 min-w-0 overflow-hidden">{@render request?.()}</div>
    {@render resizeHandle('grid-column: 2; grid-row: 1')}
    <div class="min-h-0 min-w-0 overflow-hidden">{@render response?.()}</div>
  {/if}
</div>
