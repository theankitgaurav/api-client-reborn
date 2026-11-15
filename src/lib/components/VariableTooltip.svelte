<script lang="ts">
  import type { VariableInfo } from '$lib/utils/variable-tooltip';
  import { Eye, EyeOff } from '$lib/components/icons';

  interface Props {
    tooltip: VariableInfo & { x: number; y: number; placement: 'top' | 'bottom' };
    isMac: boolean;
    isAltPressed: boolean;
    revealed: boolean;
    onToggleSecret: () => void;
    onmouseenter: () => void;
    onmouseleave: () => void;
  }

  let { tooltip, isMac, isAltPressed, revealed, onToggleSecret, onmouseenter, onmouseleave }: Props = $props();
  let isRevealed = $derived(isAltPressed || revealed);
</script>

<div
  role="tooltip"
  {onmouseenter}
  {onmouseleave}
  class="ui-menu-surface fixed z-50 pointer-events-auto transition-all duration-100 ease-out p-2.5 text-xs w-72 backdrop-blur-sm {tooltip.placement === 'top' ? '-translate-y-full -mt-2' : 'mt-2'}"
  style="left: {tooltip.x}px; top: {tooltip.y}px;"
>
  <div class="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[var(--border)]">
    <div class="flex items-center gap-1.5 truncate">
      <span class="font-mono font-bold text-[10px] px-1.5 py-0.2 rounded border {tooltip.isDynamic
        ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
        : tooltip.isSecret
          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
          : tooltip.isDefined
            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}">
        &#123;&#123;{tooltip.variableName}&#125;&#125;
      </span>
    </div>
    <span class="text-[10px] font-medium text-[var(--text-muted)] shrink-0">{tooltip.source}</span>
  </div>
  <div class="space-y-1">
    <div class="text-[10px] text-[var(--text-subtle)] uppercase tracking-wider font-semibold">Value:</div>
    <div class="font-mono text-[11px] p-1.5 rounded bg-[var(--surface)] border border-[var(--border)] break-all select-text max-h-24 overflow-y-auto">
      {#if tooltip.isDefined}
        {#if tooltip.isSecret}
          <div class="flex items-center justify-between gap-1.5">
            <div class="flex-1 min-w-0">
              {#if isRevealed}
                <span class="text-[var(--warning)] font-semibold">{tooltip.variableValue || '<empty>'}</span>
              {:else}
                <span class="text-[var(--text-muted)] font-mono tracking-widest select-none">••••••••••••</span>
              {/if}
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <span class="text-[9px] text-[var(--warning)] bg-amber-500/10 px-1 py-0.5 rounded font-mono">secret</span>
              <button
                type="button"
                onclick={onToggleSecret}
                title={isRevealed ? 'Hide secret' : `Reveal secret (or hold ${isMac ? '⌥' : 'Alt'})`}
                aria-label={isRevealed ? 'Hide secret' : 'Reveal secret'}
                class="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-strong)] transition-colors rounded hover:bg-[var(--surface-hover)]"
              >
                {#if isRevealed}<EyeOff size={12} />{:else}<Eye size={12} />{/if}
              </button>
            </div>
          </div>
          <div class="text-[9px] text-[var(--text-subtle)] pt-0.5 flex items-center justify-between">
            <span>{isRevealed ? 'Revealed' : 'Hidden for security'}</span>
            <span class="font-mono text-[8px] opacity-75">{isMac ? 'Hold ⌥ to peek' : 'Hold Alt to peek'}</span>
          </div>
        {:else}
          <span class="text-[var(--success)] font-semibold">{tooltip.variableValue || '<empty string>'}</span>
        {/if}
      {:else}
        <div class="text-[var(--danger)] italic flex items-center gap-1">
          <span>⚠️ Not found</span>
          <span class="text-[var(--text-muted)] font-sans text-[10px]">(click Variables in navbar)</span>
        </div>
      {/if}
    </div>
  </div>
</div>
