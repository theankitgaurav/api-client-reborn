<script lang="ts">
  import { shortcutsState } from '$lib/state/shortcuts.svelte';
  import { SHORTCUT_DEFINITIONS, type ShortcutItem } from '$lib/utils/shortcuts';
  import { X, Search, Keyboard } from '$lib/components/icons';

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

{#if shortcutsState.isCheatSheetOpen}
  <div
    class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 outline-none"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => {
      if (e.target === e.currentTarget) shortcutsState.closeCheatSheet();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') shortcutsState.closeCheatSheet();
    }}
  >
    <div
      class="bg-white dark:bg-[#1e1e1e] border border-neutral-200 dark:border-[#333333] rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden text-neutral-800 dark:text-neutral-200 text-xs"
    >
      <!-- Header -->
      <div
        class="px-5 py-3.5 border-b border-neutral-200 dark:border-[#2d2d2d] flex items-center justify-between bg-neutral-50/50 dark:bg-[#252526]"
      >
        <div class="flex items-center gap-2">
          <div class="p-1.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg">
            <Keyboard size={18} />
          </div>
          <div>
            <h2 class="font-semibold text-sm">Keyboard Shortcuts</h2>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              Quick reference for navigation and actions ({isMac ? 'macOS' : 'Windows / Linux'})
            </p>
          </div>
        </div>

        <button
          onclick={() => shortcutsState.closeCheatSheet()}
          title="Close (Esc)"
          class="p-1 rounded-md text-neutral-400 hover:text-neutral-800 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <!-- Search Filter Bar -->
      <div class="p-3 border-b border-neutral-200 dark:border-[#2d2d2d] bg-white dark:bg-[#1e1e1e]">
        <div class="relative">
          <Search size={14} class="absolute left-3 top-2.5 text-neutral-400" />
          <input
            type="text"
            placeholder="Search shortcuts (e.g. tab, send, save, url)..."
            bind:value={shortcutsState.searchQuery}
            class="w-full bg-[#f6f6f8] dark:bg-[#252526] border border-neutral-300 dark:border-[#383838] rounded-lg pl-9 pr-3 py-1.5 text-xs text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-[#1a1a1a] transition-all"
          />
        </div>
      </div>

      <!-- Content Categories -->
      <div class="flex-1 overflow-y-auto p-5 space-y-6">
        {#each categories as category}
          {@const items = getCategoryShortcuts(category)}
          {#if items.length > 0}
            <div>
              <div
                class="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider mb-2.5 pb-1 border-b border-neutral-100 dark:border-[#282828]"
              >
                {category}
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                {#each items as item}
                  <div
                    class="flex items-center justify-between p-2 rounded-lg bg-neutral-50/70 dark:bg-[#252526]/60 border border-neutral-100 dark:border-[#2d2d2d] hover:border-neutral-300 dark:hover:border-[#404040] transition-colors"
                  >
                    <div class="min-w-0 pr-2">
                      <div class="font-medium text-neutral-800 dark:text-neutral-200 truncate">
                        {item.label}
                      </div>
                      <div class="text-[10px] text-neutral-500 dark:text-neutral-400 truncate">
                        {item.description}
                      </div>
                    </div>

                    <!-- Keys Badges -->
                    <div class="flex items-center gap-1 shrink-0 font-mono text-[11px]">
                      {#each isMac ? item.macKeys : item.winKeys as key}
                        <kbd
                          class="px-1.5 py-0.5 rounded bg-white dark:bg-[#181818] border border-neutral-200 dark:border-[#383838] shadow-sm font-semibold text-neutral-700 dark:text-neutral-300 min-w-[20px] text-center"
                        >
                          {key}
                        </kbd>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {/each}

        {#if filteredShortcuts().length === 0}
          <div class="text-center py-12 text-neutral-400 dark:text-neutral-500 text-xs">
            No keyboard shortcuts matched "{shortcutsState.searchQuery}"
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div
        class="px-5 py-2.5 border-t border-neutral-200 dark:border-[#2d2d2d] bg-neutral-50 dark:bg-[#252526] flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400"
      >
        <span>Press <kbd class="px-1.5 py-0.5 rounded bg-white dark:bg-[#181818] border border-neutral-300 dark:border-[#383838] font-mono text-[10px]">Esc</kbd> anytime to close this dialog</span>
        <button
          onclick={() => shortcutsState.closeCheatSheet()}
          class="px-3 py-1 rounded bg-neutral-200 dark:bg-[#333333] hover:bg-neutral-300 dark:hover:bg-[#404040] text-neutral-700 dark:text-neutral-200 transition-colors font-medium text-xs"
        >
          Close
        </button>
      </div>
    </div>
  </div>
{/if}
