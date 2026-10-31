export type ThemeMode = 'dark' | 'light' | 'system';

export class ThemeState {
  mode = $state<ThemeMode>('system');
  systemIsDark = $state(false);
  private mediaQuery: MediaQueryList | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme_mode') as ThemeMode | null;
      if (saved && (saved === 'dark' || saved === 'light' || saved === 'system')) {
        this.mode = saved;
      }
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.systemIsDark = this.mediaQuery.matches;
      this.mediaQuery.addEventListener('change', (event) => {
        this.systemIsDark = event.matches;
        if (this.mode === 'system') this.applyTheme();
      });

      // WebViews may miss an appearance event while suspended; resync on return.
      window.addEventListener('focus', () => this.syncSystemTheme());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.syncSystemTheme();
      });
      this.applyTheme();
    }
  }

  setMode(mode: ThemeMode) {
    this.mode = mode;
    localStorage.setItem('theme_mode', mode);
    this.applyTheme();
  }

  toggle() {
    if (this.mode === 'system') {
      this.setMode(this.isDark() ? 'light' : 'dark');
      return;
    }
    this.setMode(this.mode === 'dark' ? 'light' : 'dark');
  }

  cycleMode() {
    const nextMode: Record<ThemeMode, ThemeMode> = {
      system: 'light',
      light: 'dark',
      dark: 'system',
    };
    this.setMode(nextMode[this.mode]);
  }

  private syncSystemTheme() {
    if (!this.mediaQuery) return;
    const isDark = this.mediaQuery.matches;
    if (isDark !== this.systemIsDark) this.systemIsDark = isDark;
    if (this.mode === 'system') this.applyTheme();
  }

  isDark(): boolean {
    if (this.mode === 'dark') return true;
    if (this.mode === 'light') return false;
    return this.systemIsDark;
  }

  applyTheme() {
    if (typeof document === 'undefined') return;
    const isDark = this.isDark();
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  }
}

export const themeState = new ThemeState();
