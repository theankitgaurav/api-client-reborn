import { relaunchApp } from '../ipc.ts';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateMetadata {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export class UpdaterState {
  status = $state<UpdateStatus>('idle');
  isModalOpen = $state(false);
  hasUpdateNotification = $state(false);

  currentVersion = $state('0.10.0');
  availableVersion = $state<string | null>(null);
  releaseDate = $state<string | null>(null);
  releaseNotes = $state<string | null>(null);

  downloadProgress = $state(0);
  downloadedBytes = $state(0);
  totalBytes = $state(0);
  errorMessage = $state<string | null>(null);

  private updateHandle: any = null;
  private unlistenMenu: (() => void) | null = null;
  private isInitialized = false;

  get isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    if (this.isTauri) {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        this.unlistenMenu = await listen('check-for-updates', () => {
          this.checkForUpdates({ manual: true });
        });
      } catch (err) {
        console.warn('[Updater] Failed to register menu event listener', err);
      }
    }

    // Quiet background check after initial launch delay
    if (typeof setTimeout !== 'undefined') {
      setTimeout(() => {
        this.checkForUpdates({ manual: false });
      }, 3000);
    }
  }

  destroy() {
    if (this.unlistenMenu) {
      this.unlistenMenu();
      this.unlistenMenu = null;
    }
    this.isInitialized = false;
  }

  openModal() {
    this.isModalOpen = true;
  }

  closeModal() {
    this.isModalOpen = false;
  }

  dismissNotification() {
    this.hasUpdateNotification = false;
  }

  async checkForUpdates(options: { manual?: boolean } = {}) {
    if (this.status === 'checking' || this.status === 'downloading') {
      if (options.manual) this.isModalOpen = true;
      return;
    }

    this.status = 'checking';
    this.errorMessage = null;

    if (options.manual) {
      this.isModalOpen = true;
    }

    if (!this.isTauri) {
      // Mock environment (browser development / node unit tests)
      this.status = 'up-to-date';
      return;
    }

    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();

      if (update) {
        this.updateHandle = update;
        this.currentVersion = update.currentVersion || this.currentVersion;
        this.availableVersion = update.version;
        this.releaseDate = update.date || null;
        this.releaseNotes = update.body || null;
        this.status = 'available';
        this.hasUpdateNotification = true;
        if (options.manual) {
          this.isModalOpen = true;
        }
      } else {
        this.updateHandle = null;
        this.status = 'up-to-date';
        this.hasUpdateNotification = false;
      }
    } catch (err: any) {
      console.error('[Updater] Check failed:', err);
      this.status = 'error';

      const rawMsg = err instanceof Error ? err.message : String(err);
      if (
        rawMsg.includes('signature') ||
        rawMsg.includes('Could not find') ||
        rawMsg.includes('404') ||
        rawMsg.includes('not found')
      ) {
        this.errorMessage =
          'Update check requires a published release with cryptographic signatures. Local development builds cannot auto-update.';
      } else if (rawMsg.includes('network') || rawMsg.includes('dns') || rawMsg.includes('connection')) {
        this.errorMessage =
          'Could not reach the update server. Please verify your internet connection.';
      } else {
        this.errorMessage = rawMsg;
      }

      // If not triggered manually by the user, do not open the modal on background error
      if (!options.manual) {
        this.hasUpdateNotification = false;
      }
    }
  }

  async downloadAndInstall() {
    if (!this.updateHandle) {
      // Browser mock simulation support for tests
      if (!this.isTauri && this.status === 'available') {
        this.status = 'downloading';
        this.downloadProgress = 100;
        this.status = 'downloaded';
      }
      return;
    }

    this.status = 'downloading';
    this.downloadProgress = 0;
    this.downloadedBytes = 0;
    this.totalBytes = 0;
    this.errorMessage = null;

    try {
      await this.updateHandle.downloadAndInstall((event: any) => {
        if (!event) return;
        if (event.event === 'Started') {
          this.totalBytes = event.data?.contentLength || 0;
        } else if (event.event === 'Progress') {
          this.downloadedBytes += event.data?.chunkLength || 0;
          if (this.totalBytes > 0) {
            this.downloadProgress = Math.min(
              100,
              Math.round((this.downloadedBytes / this.totalBytes) * 100)
            );
          }
        } else if (event.event === 'Finished') {
          this.downloadProgress = 100;
        }
      });

      this.status = 'downloaded';
      this.hasUpdateNotification = false;
    } catch (err: any) {
      console.error('[Updater] Download & install failed:', err);
      this.status = 'error';
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async restartApp() {
    await relaunchApp();
  }
}

export const updaterState = new UpdaterState();
