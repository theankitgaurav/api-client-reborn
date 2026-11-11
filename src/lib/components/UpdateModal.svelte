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
    class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 outline-none"
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
      class="bg-white dark:bg-[#1e1e1e] border border-neutral-200 dark:border-[#333333] rounded-xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden text-neutral-800 dark:text-neutral-200 text-xs"
    >
      <!-- Header -->
      <div
        class="px-5 py-3.5 border-b border-neutral-200 dark:border-[#2d2d2d] flex items-center justify-between bg-neutral-50/50 dark:bg-[#252526]"
      >
        <div class="flex items-center gap-2.5">
          <div class="p-1.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg">
            <Layers size={18} />
          </div>
          <div>
            <h2 class="font-semibold text-sm">Software Update</h2>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              API Client Reborn • v{updaterState.currentVersion}
            </p>
          </div>
        </div>

        {#if updaterState.status !== 'downloading'}
          <button
            onclick={() => updaterState.closeModal()}
            title="Close (Esc)"
            class="p-1 rounded-md text-neutral-400 hover:text-neutral-800 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 transition-colors"
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
            <div class="p-3 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full animate-spin">
              <RefreshCw size={24} />
            </div>
            <div>
              <div class="font-semibold text-sm">Checking for updates…</div>
              <div class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
                Connecting to update servers to verify the latest release
              </div>
            </div>
          </div>

        <!-- 2. UP TO DATE STATE -->
        {:else if updaterState.status === 'up-to-date'}
          <div class="flex flex-col items-center justify-center py-6 text-center space-y-3">
            <div class="p-3 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full">
              <Check size={28} />
            </div>
            <div>
              <div class="font-semibold text-sm">You're on the latest version!</div>
              <div class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
                API Client Reborn <span class="font-mono font-medium">v{updaterState.currentVersion}</span> is currently the newest version available.
              </div>
            </div>
            <button
              onclick={() => updaterState.checkForUpdates({ manual: true })}
              class="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-medium transition-colors"
            >
              <RefreshCw size={13} />
              Check Again
            </button>
          </div>

        <!-- 3. UPDATE AVAILABLE STATE -->
        {:else if updaterState.status === 'available'}
          <div class="space-y-4">
            <div class="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-[#2d2d2d]">
              <div>
                <div class="font-semibold text-sm text-neutral-900 dark:text-white">
                  A new release is available!
                </div>
                <div class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Published {updaterState.releaseDate ? new Date(updaterState.releaseDate).toLocaleDateString() : 'recently'}
                </div>
              </div>
              <div class="flex items-center gap-1.5 font-mono text-xs">
                <span class="px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                  v{updaterState.currentVersion}
                </span>
                <span class="text-neutral-400">→</span>
                <span class="px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
                  v{updaterState.availableVersion}
                </span>
              </div>
            </div>

            <!-- Release Notes Preview -->
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                Release Notes
              </div>
              <div
                class="max-h-48 overflow-y-auto p-3 rounded-lg bg-neutral-50 dark:bg-[#161616] border border-neutral-200/80 dark:border-[#2e2e2e] font-mono text-[11px] text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap leading-relaxed select-text"
              >
                {updaterState.releaseNotes || '• General performance enhancements and bug fixes.'}
              </div>
            </div>

            <div class="flex items-center justify-end gap-2 pt-2">
              <button
                onclick={() => updaterState.closeModal()}
                class="px-3.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-xs font-medium transition-colors"
              >
                Remind Me Later
              </button>
              <button
                onclick={() => updaterState.downloadAndInstall()}
                class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors flex items-center gap-1.5 shadow-sm"
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
                <div class="font-semibold text-sm">Downloading Update…</div>
                <div class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Updating to v{updaterState.availableVersion}
                </div>
              </div>
              <span class="font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">
                {updaterState.downloadProgress}%
              </span>
            </div>

            <!-- Progress Bar -->
            <div class="w-full bg-neutral-200 dark:bg-neutral-800 h-2.5 rounded-full overflow-hidden">
              <div
                class="bg-blue-600 h-full rounded-full transition-all duration-200"
                style="width: {updaterState.downloadProgress}%"
              ></div>
            </div>

            <div class="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
              {#if updaterState.totalBytes > 0}
                <span>
                  {formatBytes(updaterState.downloadedBytes)} / {formatBytes(updaterState.totalBytes)}
                </span>
              {:else}
                <span>Downloading update archive…</span>
              {/if}
              <span class="flex items-center gap-1 text-neutral-400">
                <RefreshCw size={11} class="animate-spin" />
                Verifying package signature
              </span>
            </div>
          </div>

        <!-- 5. DOWNLOADED / READY TO RESTART STATE -->
        {:else if updaterState.status === 'downloaded'}
          <div class="flex flex-col items-center justify-center py-4 text-center space-y-3">
            <div class="p-3 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full">
              <Check size={28} />
            </div>
            <div>
              <div class="font-semibold text-sm text-neutral-900 dark:text-white">
                Update Ready to Apply!
              </div>
              <div class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1 max-w-sm">
                Version <span class="font-mono font-medium">v{updaterState.availableVersion}</span> has been downloaded and verified. Restart the application now to complete the update.
              </div>
            </div>

            <div class="flex items-center gap-2 pt-2">
              <button
                onclick={() => updaterState.closeModal()}
                class="px-3.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-xs font-medium transition-colors"
              >
                Restart Later
              </button>
              <button
                onclick={() => updaterState.restartApp()}
                class="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors flex items-center gap-1.5 shadow-sm"
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
              <div class="p-2 bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg shrink-0 mt-0.5">
                <AlertCircle size={20} />
              </div>
              <div class="flex-1">
                <div class="font-semibold text-sm text-neutral-900 dark:text-white">
                  Update Check Incomplete
                </div>
                <div class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                  {updaterState.errorMessage || 'An unexpected error occurred while communicating with the update server.'}
                </div>
              </div>
            </div>

            <div class="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100 dark:border-[#2d2d2d]">
              <button
                onclick={openGitHubReleases}
                class="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-xs font-medium transition-colors"
              >
                Open GitHub Releases
              </button>
              <button
                onclick={() => updaterState.checkForUpdates({ manual: true })}
                class="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors flex items-center gap-1.5 shadow-sm"
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
        class="px-5 py-2.5 border-t border-neutral-200 dark:border-[#2d2d2d] bg-neutral-50 dark:bg-[#252526] flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400"
      >
        <span>Protected by Minisign Ed25519 Cryptographic Signatures</span>
        {#if updaterState.status !== 'downloading'}
          <button
            onclick={() => updaterState.closeModal()}
            class="px-3 py-1 rounded bg-neutral-200 dark:bg-[#333333] hover:bg-neutral-300 dark:hover:bg-[#404040] text-neutral-700 dark:text-neutral-200 transition-colors font-medium text-xs"
          >
            Close
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
