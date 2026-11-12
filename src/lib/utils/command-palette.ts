import type { CommandPaletteItem } from '../state/ui.svelte';

export function scoreCommand(item: CommandPaletteItem, query: string): number {
  if (!query.trim()) return 0;
  const haystack = [item.label, item.description || '', ...(item.keywords || [])].join(' ').toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let total = 0;

  for (const term of terms) {
    if (item.label.toLowerCase().startsWith(term)) total += 5;
    else if (item.label.toLowerCase().includes(term)) total += 3;
    else if (haystack.includes(term)) total += 1;
    else return -1;
  }

  return total;
}

export function filterCommandItems(items: CommandPaletteItem[], query: string): CommandPaletteItem[] {
  return items
    .map((item, order) => ({ item, order, score: scoreCommand(item, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.item);
}
