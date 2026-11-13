<script lang="ts">
  import { updaterState, formatBytes } from '$lib/state/updater.svelte';
  import {
    Download,
    RefreshCw,
    Check,
    AlertCircle,
    X,
    Layers,
  } from '$lib/components/icons';

  async function openGitHubReleases() {
    const url = 'https://github.com/theankitgaurav/api-client-reborn/releases';
    if (updaterState.isTauri) {
      try {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(url);
        return;
      } catch (err) {
        console.warn('Failed to open shell URL:', err);
      }
    }
    window.open(url, '_blank');
  }
</script>

{#if updaterState.isModalOpen}
  <div
    class="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4 animate-in fade-in duration-150 outline-none"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => {
      if (e.target === e.currentTarget && updaterState.status !== 'downloading') {
        updaterState.closeModal();
      }
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape' && updaterState.status !== 'downloading') {
        updaterState.closeModal();
      }
    }}
  >
    <div
      class="bg-[var(--surface-raised)] border border-[var(--border-strong)] rounded-lg shadow-2xl w-full max-w-lg flex flex-col overflow-hidden text-[var(--text)] text-xs"
    >
      <!-- Header -->
      <div
        class="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-muted)]"
      >
        <div class="flex items-center gap-2.5">
          <div class="p-1.5 bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)] rounded-lg">
            <Layers size={18} />
          </div>
          <div>
            <h2 class="font-semibold text-sm text-[var(--text-strong)]">Software Update</h2>
            <p class="text-[11px] text-[var(--text-muted)]">
              API Client Reborn • v{updaterState.currentVersion}
            </p>
          </div>
        </div>

        {#if updaterState.status !== 'downloading'}
          <button
            onclick={() => updaterState.closeModal()}
            title="Close (Esc)"
            class="ui-icon-button"
          >
            <X size={16} />
          </button>
        {/if}
      </div>

      <!-- Content Body -->
      <div class="p-6">
        <!-- 1. CHECKING STATE -->
        {#if updaterState.status === 'checking'}
          <div class="flex flex-col items-center justify-center py-6 text-center space-y-3">
            <div class="p-3 bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)] rounded-full animate-spin">
              <RefreshCw size={24} />
            </div>
            <div>
              <div class="font-semibold text-sm text-[var(--text-strong)]">Checking for updates…</div>
              <div class="text-[11px] text-[var(--text-muted)] mt-1">
                Connecting to update servers to verify the latest release
              </div>
            </div>
          </div>

        <!-- 2. UP TO DATE STATE -->
        {:else if updaterState.status === 'up-to-date'}
          <div class="flex flex-col items-center justify-center py-6 text-center space-y-3">
            <div class="p-3 bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success)] rounded-full">
              <Check size={28} />
            </div>
            <div>
              <div class="font-semibold text-sm text-[var(--text-strong)]">You're on the latest version!</div>
              <div class="text-[11px] text-[var(--text-muted)] mt-1">
                API Client Reborn <span class="font-mono font-medium">v{updaterState.currentVersion}</span> is currently the newest version available.
              </div>
            </div>
            <button
              onclick={() => updaterState.checkForUpdates({ manual: true })}
              class="ui-button ui-button-secondary mt-2 px-3 py-1.5"
            >
              <RefreshCw size={13} />
              Check Again
            </button>
          </div>

        <!-- 3. UPDATE AVAILABLE STATE -->
        {:else if updaterState.status === 'available'}
          <div class="space-y-4">
            <div class="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div>
                <div class="font-semibold text-sm text-[var(--text-strong)]">
                  A new release is available!
                </div>
                <div class="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Published {updaterState.releaseDate ? new Date(updaterState.releaseDate).toLocaleDateString() : 'recently'}
                </div>
              </div>
              <div class="flex items-center gap-1.5 font-mono text-xs">
                <span class="px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)]">
                  v{updaterState.currentVersion}
                </span>
                <span class="text-[var(--text-subtle)]">→</span>
                <span class="px-2 py-0.5 rounded bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)] font-semibold">
                  v{updaterState.availableVersion}
                </span>
              </div>
            </div>

            <!-- Release Notes Preview -->
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-subtle)] mb-1.5">
                Release Notes
              </div>
              <div
                class="max-h-48 overflow-y-auto p-3 rounded-lg bg-[var(--surface-muted)] border border-[var(--border)] font-mono text-[11px] text-[var(--text)] whitespace-pre-wrap leading-relaxed select-text"
              >
                {updaterState.releaseNotes || '• General performance enhancements and bug fixes.'}
              </div>
            </div>

            <div class="flex items-center justify-end gap-2 pt-2">
              <button
                onclick={() => updaterState.closeModal()}
                class="ui-button ui-button-secondary px-3.5 py-1.5"
              >
                Remind Me Later
              </button>
              <button
                onclick={() => updaterState.downloadAndInstall()}
                class="ui-button ui-button-primary px-4 py-1.5"
              >
                <Download size={14} />
                Download & Install
              </button>
            </div>
          </div>

        <!-- 4. DOWNLOADING STATE -->
        {:else if updaterState.status === 'downloading'}
          <div class="py-4 space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <div class="font-semibold text-sm text-[var(--text-strong)]">Downloading Update…</div>
                <div class="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Updating to v{updaterState.availableVersion}
                </div>
              </div>
              <span class="font-mono text-sm font-semibold text-[var(--accent)]">
                {updaterState.downloadProgress}%
              </span>
            </div>

            <!-- Progress Bar -->
            <div class="w-full bg-[var(--surface-hover)] h-2.5 rounded-full overflow-hidden">
              <div
                class="bg-[var(--accent)] h-full rounded-full transition-all duration-200"
                style="width: {updaterState.downloadProgress}%"
              ></div>
            </div>

            <div class="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
              {#if updaterState.totalBytes > 0}
                <span>
                  {formatBytes(updaterState.downloadedBytes)} / {formatBytes(updaterState.totalBytes)}
                </span>
              {:else}
                <span>Downloading update archive…</span>
              {/if}
              <span class="flex items-center gap-1 text-[var(--text-subtle)]">
                <RefreshCw size={11} class="animate-spin" />
                Verifying package signature
              </span>
            </div>
          </div>

        <!-- 5. DOWNLOADED / READY TO RESTART STATE -->
        {:else if updaterState.status === 'downloaded'}
          <div class="flex flex-col items-center justify-center py-4 text-center space-y-3">
            <div class="p-3 bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success)] rounded-full">
              <Check size={28} />
            </div>
            <div>
              <div class="font-semibold text-sm text-[var(--text-strong)]">
                Update Ready to Apply!
              </div>
              <div class="text-[11px] text-[var(--text-muted)] mt-1 max-w-sm">
                Version <span class="font-mono font-medium">v{updaterState.availableVersion}</span> has been downloaded and verified. Restart the application now to complete the update.
              </div>
            </div>

            <div class="flex items-center gap-2 pt-2">
              <button
                onclick={() => updaterState.closeModal()}
                class="ui-button ui-button-secondary px-3.5 py-1.5"
              >
                Restart Later
              </button>
              <button
                onclick={() => updaterState.restartApp()}
                class="ui-button px-4 py-1.5 bg-[var(--success)] text-white hover:brightness-110 transition-all"
              >
                <RefreshCw size={14} />
                Restart Now
              </button>
            </div>
          </div>

        <!-- 6. ERROR STATE -->
        {:else if updaterState.status === 'error'}
          <div class="py-3 space-y-4">
            <div class="flex items-start gap-3">
              <div class="p-2 bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)] rounded-lg shrink-0 mt-0.5">
                <AlertCircle size={20} />
              </div>
              <div class="flex-1">
                <div class="font-semibold text-sm text-[var(--text-strong)]">
                  Update Check Incomplete
                </div>
                <div class="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
                  {updaterState.errorMessage || 'An unexpected error occurred while communicating with the update server.'}
                </div>
              </div>
            </div>

            <div class="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button
                onclick={openGitHubReleases}
                class="ui-button ui-button-secondary px-3 py-1.5"
              >
                Open GitHub Releases
              </button>
              <button
                onclick={() => updaterState.checkForUpdates({ manual: true })}
                class="ui-button ui-button-primary px-3.5 py-1.5"
              >
                <RefreshCw size={13} />
                Retry
              </button>
            </div>
          </div>
        {/if}
      </div>

      <!-- Footer Info -->
      <div
        class="px-5 py-2.5 border-t border-[var(--border)] bg-[var(--surface-muted)] flex items-center justify-between text-[11px] text-[var(--text-muted)]"
      >
        <span>Protected by Minisign Ed25519 Cryptographic Signatures</span>
        {#if updaterState.status !== 'downloading'}
          <button
            onclick={() => updaterState.closeModal()}
            class="ui-button ui-button-secondary px-3 py-1"
          >
            Close
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
