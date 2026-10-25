<script lang="ts">
  import { envState } from '$lib/state/env.svelte';
  import { X, KeyRound, Eye, EyeOff, Plus, Trash2, ShieldCheck } from 'lucide-svelte';

  let secretsMap = $state<Record<string, string>>({ ...envState.secrets });
  let revealedSecrets = $state<Record<string, boolean>>({});
  let newKey = $state('');
  let newValue = $state('');

  function toggleReveal(key: string) {
    revealedSecrets[key] = !revealedSecrets[key];
  }

  function addSecret() {
    if (newKey.trim()) {
      secretsMap[newKey.trim()] = newValue;
      newKey = '';
      newValue = '';
    }
  }

  function deleteSecret(key: string) {
    delete secretsMap[key];
    // Trigger reactivity
    secretsMap = { ...secretsMap };
  }

  async function handleSave() {
    await envState.updateSecrets(secretsMap);
    envState.isSecretsModalOpen = false;
  }
</script>

{#if envState.isSecretsModalOpen}
  <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-[#202020] border border-[#333] rounded-lg shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[85vh] text-xs">
      <!-- Modal Header -->
      <div class="px-4 py-3 bg-[#252526] border-b border-[#333] flex items-center justify-between">
        <div class="flex items-center gap-2">
          <KeyRound size={16} class="text-amber-400" />
          <h2 class="font-semibold text-neutral-200 text-sm">Local Secrets Manager</h2>
        </div>
        <button
          onclick={() => (envState.isSecretsModalOpen = false)}
          class="text-neutral-400 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      <!-- Security Notice -->
      <div class="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 flex items-center gap-2 text-[11px]">
        <ShieldCheck size={14} class="shrink-0" />
        <span>Stored strictly in <code class="font-mono bg-black/30 px-1 py-0.5 rounded">.apiclient/.secrets.env</code> and excluded from Git commits.</span>
      </div>

      <!-- Secrets Table -->
      <div class="p-4 flex-1 overflow-y-auto space-y-3">
        {#each Object.entries(secretsMap) as [k, v]}
          <div class="flex items-center gap-2">
            <span class="w-1/3 font-mono text-neutral-300 truncate bg-[#181818] px-2 py-1.5 rounded border border-[#333]">
              {k}
            </span>
            <div class="relative flex-1">
              <input
                type={revealedSecrets[k] ? 'text' : 'password'}
                bind:value={secretsMap[k]}
                class="w-full bg-[#181818] border border-[#333] rounded px-2 py-1.5 font-mono text-neutral-200 pr-8 focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onclick={() => toggleReveal(k)}
                class="absolute right-2 top-2 text-neutral-500 hover:text-neutral-300"
              >
                {#if revealedSecrets[k]}
                  <EyeOff size={13} />
                {:else}
                  <Eye size={13} />
                {/if}
              </button>
            </div>
            <button
              onclick={() => deleteSecret(k)}
              class="p-1.5 text-neutral-500 hover:text-rose-400 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        {/each}

        <!-- Add New Secret Row -->
        <div class="flex items-center gap-2 pt-2 border-t border-[#303030]">
          <input
            type="text"
            placeholder="SECRET_KEY_NAME"
            bind:value={newKey}
            class="w-1/3 bg-[#181818] border border-[#333] rounded px-2 py-1.5 font-mono text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-blue-500"
          />
          <input
            type="password"
            placeholder="secret value"
            bind:value={newValue}
            class="flex-1 bg-[#181818] border border-[#333] rounded px-2 py-1.5 font-mono text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-blue-500"
          />
          <button
            onclick={addSecret}
            class="flex items-center gap-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-1.5 rounded border border-[#444] transition-colors"
          >
            <Plus size={13} />
            <span>Add</span>
          </button>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="px-4 py-3 bg-[#252526] border-t border-[#333] flex justify-end gap-2">
        <button
          onclick={() => (envState.isSecretsModalOpen = false)}
          class="px-3 py-1.5 rounded text-neutral-400 hover:text-white"
        >
          Cancel
        </button>
        <button
          onclick={handleSave}
          class="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium shadow"
        >
          Save Changes
        </button>
      </div>
    </div>
  </div>
{/if}
