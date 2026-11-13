<script lang="ts">
  import { shortcutsState } from '$lib/state/shortcuts.svelte';
  import { SHORTCUT_DEFINITIONS, type ShortcutItem } from '$lib/utils/shortcuts';
  import { Search, Keyboard } from '$lib/components/icons';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Kbd from '$lib/components/ui/Kbd.svelte';

  let isMac = $derived(shortcutsState.isMac);

  let filteredShortcuts = $derived(() => {
    const q = shortcutsState.searchQuery.trim().toLowerCase();
    if (!q) return SHORTCUT_DEFINITIONS;
    return SHORTCUT_DEFINITIONS.filter((s) => {
      const keys = (isMac ? s.macKeys : s.winKeys).join(' ').toLowerCase();
      return (
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        keys.includes(q)
      );
    });
  });

  const categories: ('Tabs' | 'Request' | 'Navigation' | 'General')[] = [
    'Tabs',
    'Request',
    'Navigation',
    'General',
  ];

  function getCategoryShortcuts(cat: string): ShortcutItem[] {
    return filteredShortcuts().filter((s) => s.category === cat);
  }
</script>

<Modal
  isOpen={shortcutsState.isCheatSheetOpen}
  title="Keyboard Shortcuts"
  description="Reference guide for navigation and actions ({isMac ? 'macOS' : 'Windows / Linux'})"
  maxWidth="2xl"
  onclose={() => shortcutsState.closeCheatSheet()}
>
  {#snippet icon()}
    <Keyboard size={15} class="text-[var(--accent)]" />
  {/snippet}

  <div class="flex flex-col text-xs">
    <!-- Search Filter Bar -->
    <div class="p-3 border-b border-[var(--border)] bg-[var(--surface-muted)]">
      <div class="relative">
        <Search size={13} class="absolute left-2.5 top-2 text-[var(--text-subtle)]" />
        <input
          type="text"
          placeholder="Filter shortcuts (e.g. tab, send, save, url)…"
          bind:value={shortcutsState.searchQuery}
          class="w-full bg-[var(--surface)] border border-[var(--border)] rounded pl-8 pr-3 py-1.5 text-xs text-[var(--text-strong)] placeholder:text-[var(--text-subtle)] outline-none focus:border-[var(--focus)] transition-colors"
        />
      </div>
    </div>

    <!-- Content Categories -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4 max-h-[55vh] bg-[var(--surface)]">
      {#each categories as category}
        {@const items = getCategoryShortcuts(category)}
        {#if items.length > 0}
          <div>
            <div class="text-[10px] font-semibold text-[var(--text-subtle)] uppercase tracking-wider mb-2 pb-1 border-b border-[var(--border)]">
              {category}
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              {#each items as item}
                <div class="flex items-center justify-between p-2 rounded border border-[var(--border)] bg-[var(--surface-muted)] hover:bg-[var(--surface-hover)] transition-colors">
                  <div class="min-w-0 pr-2">
                    <div class="font-medium text-[var(--text-strong)] truncate">
                      {item.label}
                    </div>
                    <div class="text-[10px] text-[var(--text-muted)] truncate">
                      {item.description}
                    </div>
                  </div>

                  <!-- Keys Badges -->
                  <div class="flex items-center gap-1 shrink-0">
                    {#each isMac ? item.macKeys : item.winKeys as key}
                      <Kbd class="min-w-[20px] text-center font-bold">{key}</Kbd>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/each}

      {#if filteredShortcuts().length === 0}
        <div class="text-center py-10 text-[var(--text-subtle)] text-xs">
          No keyboard shortcuts matched "{shortcutsState.searchQuery}"
        </div>
      {/if}
    </div>
  </div>

  {#snippet footer()}
    <span class="text-[10px] text-[var(--text-subtle)] mr-auto">Press <Kbd>Esc</Kbd> to close</span>
    <button
      type="button"
      onclick={() => shortcutsState.closeCheatSheet()}
      class="ui-button ui-button-secondary h-7 px-3 text-[11px]"
    >
      Close
    </button>
  {/snippet}
</Modal>
