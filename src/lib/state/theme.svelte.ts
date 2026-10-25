export type ThemeMode = 'dark' | 'light' | 'system';

export class ThemeState {
  mode = $state<ThemeMode>('dark');

  constructor() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme_mode') as ThemeMode | null;
      if (saved && (saved === 'dark' || saved === 'light' || saved === 'system')) {
        this.mode = saved;
      }
      this.applyTheme();

      // Listen to OS scheme changes
      window
        .matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', () => {
          if (this.mode === 'system') {
            this.applyTheme();
          }
        });
    }
  }

  setMode(mode: ThemeMode) {
    this.mode = mode;
    localStorage.setItem('theme_mode', mode);
    this.applyTheme();
  }

  toggle() {
    if (this.mode === 'dark') {
      this.setMode('light');
    } else if (this.mode === 'light') {
      this.setMode('dark');
    } else {
      this.setMode('dark');
    }
  }

  isDark(): boolean {
    if (this.mode === 'dark') return true;
    if (this.mode === 'light') return false;
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true;
  }

  applyTheme() {
    if (typeof document === 'undefined') return;
    const isDark = this.isDark();
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
}

export const themeState = new ThemeState();
