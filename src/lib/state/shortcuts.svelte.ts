export class ShortcutsState {
  isCheatSheetOpen = $state(false);
  searchQuery = $state('');

  get isMac(): boolean {
    if (typeof navigator === 'undefined') return true;
    return /Mac|iPod|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  }

  openCheatSheet() {
    this.searchQuery = '';
    this.isCheatSheetOpen = true;
  }

  closeCheatSheet() {
    this.isCheatSheetOpen = false;
  }

  toggleCheatSheet() {
    if (this.isCheatSheetOpen) {
      this.closeCheatSheet();
    } else {
      this.openCheatSheet();
    }
  }
}

export const shortcutsState = new ShortcutsState();
