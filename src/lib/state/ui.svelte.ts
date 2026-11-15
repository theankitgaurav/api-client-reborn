import {
  persistSidebarWidth,
  persistSplitRatio,
  readSidebarWidth,
  resetSidebarWidth as resetStoredSidebarWidth,
  resetSplitRatio as resetStoredSplitRatio,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_STORAGE_KEY,
  SPLIT_RATIO_DEFAULT,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  SPLIT_RATIO_STORAGE_KEY,
} from '$lib/utils/panel-layout';

export type PaletteGroup = 'Actions' | 'Requests' | 'Tabs' | 'History' | 'Environments';

const readBoolean = (key: string, fallback: boolean) => {
  if (typeof localStorage === 'undefined') return fallback;
  return localStorage.getItem(key) === 'true';
};

const getStorage = () => typeof localStorage === 'undefined' ? undefined : localStorage;

const readRatio = (key: string, fallback: number) => {
  const storage = getStorage();
  if (!storage) return fallback;
  const value = Number(storage.getItem(key));
  return Number.isFinite(value) && value >= SPLIT_RATIO_MIN && value <= SPLIT_RATIO_MAX ? value : fallback;
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
  sidebarWidth = $state(readSidebarWidth(getStorage()));
  splitRatio = $state(readRatio(SPLIT_RATIO_STORAGE_KEY, SPLIT_RATIO_DEFAULT));
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

  setSidebarWidth(width: number) {
    this.sidebarWidth = persistSidebarWidth(getStorage(), width);
  }

  resetSidebarWidth() {
    this.sidebarWidth = resetStoredSidebarWidth(getStorage());
  }

  setSplitRatio(ratio: number) {
    this.splitRatio = persistSplitRatio(getStorage(), ratio);
  }

  resetSplitRatio() {
    this.splitRatio = resetStoredSplitRatio(getStorage());
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
