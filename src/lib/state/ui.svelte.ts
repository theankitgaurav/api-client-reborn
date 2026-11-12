export type PaletteGroup = 'Actions' | 'Requests' | 'Tabs' | 'History' | 'Environments';

const readBoolean = (key: string, fallback: boolean) => {
  if (typeof localStorage === 'undefined') return fallback;
  return localStorage.getItem(key) === 'true';
};

const readRatio = (key: string, fallback: number) => {
  if (typeof localStorage === 'undefined') return fallback;
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value >= 0.3 && value <= 0.7 ? value : fallback;
};

export interface CommandPaletteItem {
  id: string;
  label: string;
  description?: string;
  group: PaletteGroup;
  shortcut?: string;
  keywords?: string[];
  run: () => void | Promise<void>;
}

export class UiState {
  sidebarCollapsed = $state(readBoolean('ui_sidebar_collapsed', false));
  splitRatio = $state(readRatio('ui_split_ratio', 0.5));
  isCommandPaletteOpen = $state(false);
  commandQuery = $state('');
  commandIndex = $state(0);
  private commandPalettePreviousFocus: HTMLElement | null = null;

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.persistSidebar();
  }

  setSidebarCollapsed(collapsed: boolean) {
    this.sidebarCollapsed = collapsed;
    this.persistSidebar();
  }

  setSplitRatio(ratio: number) {
    this.splitRatio = Math.min(0.7, Math.max(0.3, ratio));
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ui_split_ratio', String(this.splitRatio));
    }
  }

  openCommandPalette() {
    this.commandPalettePreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.commandQuery = '';
    this.commandIndex = 0;
    this.isCommandPaletteOpen = true;
  }

  closeCommandPalette() {
    this.isCommandPaletteOpen = false;
    this.commandQuery = '';
    this.commandIndex = 0;
    requestAnimationFrame(() => this.commandPalettePreviousFocus?.focus());
    this.commandPalettePreviousFocus = null;
  }

  toggleCommandPalette() {
    if (this.isCommandPaletteOpen) this.closeCommandPalette();
    else this.openCommandPalette();
  }

  private persistSidebar() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ui_sidebar_collapsed', String(this.sidebarCollapsed));
    }
  }
}

export const uiState = new UiState();
