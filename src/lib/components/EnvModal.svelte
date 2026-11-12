<script lang="ts">
  import { envState } from '$lib/state/env.svelte';
  import { workspaceState } from '$lib/state/workspace.svelte';
  import type { VariableItem } from '$lib/types';
  import {
    X,
    Eye,
    EyeOff,
    Plus,
    Trash2,
    ShieldCheck,
    HardDrive,
  } from '$lib/components/icons';

  let localVars = $state<VariableItem[]>([]);
  let collectionVars = $state<VariableItem[]>([]);
  let collectionPath = $state('');
  let collectionName = $state('');
  let hasCollection = $state(false);
  let isCollectionLoading = $state(false);
  let activeSection = $state<'environment' | 'collection'>('environment');
  let saveError = $state('');
  let revealed = $state<Record<string, boolean>>({});

  let newKey = $state('');
  let newValue = $state('');
  let newIsSecret = $state(false);
  let newScope = $state<'environment' | 'workspace'>('environment');
  let newCollectionKey = $state('');
  let newCollectionValue = $state('');
  let newCollectionIsSecret = $state(false);
  let collectionLoadId = 0;
  let wasOpen = false;

  // Sync state whenever modal opens
  $effect(() => {
    const isOpen = envState.isVariablesModalOpen;
    const variables = envState.variables;
    if (!isOpen) {
      wasOpen = false;
      return;
    }
    localVars = variables.map((variable) => ({ ...variable }));
    if (!wasOpen) {
      revealed = {};
      newKey = '';
      newValue = '';
      newIsSecret = false;
      newScope = 'environment';
      activeSection = 'environment';
      saveError = '';
      newCollectionKey = '';
      newCollectionValue = '';
      newCollectionIsSecret = false;
    }
    wasOpen = true;
  });

  $effect(() => {
    if (!envState.isVariablesModalOpen) return;
    const requestPath = workspaceState.activeTab?.filePath || '';
    collectionPath = requestPath;
    hasCollection = false;
    collectionName = '';
    collectionVars = [];
    const loadId = ++collectionLoadId;
    if (!requestPath) {
      isCollectionLoading = false;
      return;
    }
    isCollectionLoading = true;
    void envState.collectionVariablesForRequest(requestPath).then((result) => {
      if (loadId !== collectionLoadId) return;
      hasCollection = result !== null;
      collectionName = result?.collection_name || '';
      collectionVars = [
        ...Object.entries(result?.public_vars || {}).map(([key, value]) => ({
          id: `collection-${key}-${Math.random()}`, key, value, isSecret: false, scope: 'collection' as const,
        })),
        ...Object.entries(result?.secret_vars || {}).map(([key, value]) => ({
          id: `collection-secret-${key}-${Math.random()}`, key, value, isSecret: true, scope: 'collection' as const,
        })),
      ];
    }).catch((error) => {
      saveError = `Could not load collection variables: ${String(error)}`;
    }).finally(() => {
      if (loadId === collectionLoadId) isCollectionLoading = false;
    });
  });

  function toggleReveal(id: string) {
    revealed[id] = !revealed[id];
  }

  function addVariable() {
    const k = newKey.trim();
    if (k) {
      localVars.push({
        id: String(Date.now() + Math.random()),
        key: k,
        value: newValue,
        isSecret: newIsSecret,
        scope: newScope,
      });
      newKey = '';
      newValue = '';
      newIsSecret = false;
    }
  }

  function deleteVariable(id: string) {
    localVars = localVars.filter((v) => v.id !== id);
  }

  function addCollectionVariable() {
    const key = newCollectionKey.trim();
    if (!key || collectionVars.some((variable) => variable.key.trim() === key)) return;
    collectionVars.push({
      id: `collection-${Date.now()}-${Math.random()}`,
      key,
      value: newCollectionValue,
      isSecret: newCollectionIsSecret,
      scope: 'collection',
    });
    newCollectionKey = '';
    newCollectionValue = '';
    newCollectionIsSecret = false;
  }

  function deleteCollectionVariable(id: string) {
    collectionVars = collectionVars.filter((variable) => variable.id !== id);
  }

  async function handleSave() {
    saveError = '';
    try {
      await envState.updateVariables(localVars);
      if (collectionPath && hasCollection) {
        await envState.updateCollectionVariables(collectionPath, collectionVars);
      }
      envState.isVariablesModalOpen = false;
    } catch (error) {
      saveError = `Could not save variables: ${String(error)}`;
    }
  }
</script>

{#if envState.isVariablesModalOpen}
  <div class="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white dark:bg-[#202020] border border-neutral-200 dark:border-[#333] rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] text-xs">
      <!-- Modal Header -->
      <div class="px-4 py-3 bg-[#f9f9fb] dark:bg-[#252526] border-b border-neutral-200 dark:border-[#333] flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="font-mono font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-xs">&#123;x&#125;</span>
          <h2 class="font-semibold text-neutral-800 dark:text-neutral-200 text-sm">Variables &amp; Secrets</h2>
          <select
            aria-label="Active environment"
            value={envState.activeEnvName}
            onchange={(event) => envState.selectEnvironment(event.currentTarget.value)}
            class="ui-select max-w-40 px-2 py-1 text-[11px]"
          >
            {#each envState.environments as environment}
              <option value={environment.name}>{environment.name}</option>
            {/each}
          </select>
          <button
            onclick={() => { envState.isVariablesModalOpen = false; workspaceState.isImportModalOpen = true; }}
            class="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
          >
            Import
          </button>
        </div>
        <button
          onclick={() => (envState.isVariablesModalOpen = false)}
          class="text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <!-- Security Notice -->
      <div class="px-4 py-2 bg-neutral-50 dark:bg-[#1a1a1a] border-b border-neutral-200 dark:border-[#333] text-neutral-600 dark:text-neutral-400 flex items-center justify-between text-[11px]">
        <div class="flex items-center gap-1.5">
          <ShieldCheck size={14} class="text-amber-500 shrink-0" />
          <span>Selected environment overrides workspace secrets. Collection variables override both. Workspace secrets are local-only.</span>
        </div>
        <span class="text-neutral-400 font-mono text-[10px]">Use via &#123;&#123;variable&#125;&#125;</span>
      </div>

      <div class="flex border-b border-neutral-200 dark:border-[#333] bg-white dark:bg-[#202020] px-4" role="tablist" aria-label="Variable scopes">
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'environment'}
          onclick={() => (activeSection = 'environment')}
          class="px-3 py-2 text-[11px] border-b-2 transition-colors {activeSection === 'environment' ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-semibold' : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}"
        >Environment &amp; Workspace</button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'collection'}
          disabled={!collectionPath || isCollectionLoading || !hasCollection}
          onclick={() => (activeSection = 'collection')}
          class="px-3 py-2 text-[11px] border-b-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed {activeSection === 'collection' ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-semibold' : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}"
        >Collection{collectionName ? ` · ${collectionName}` : ''}</button>
      </div>

      <!-- Variables Table -->
      <div class="p-4 flex-1 overflow-y-auto space-y-2 bg-white dark:bg-[#202020]">
        {#if activeSection === 'environment'}
        {#if localVars.length === 0}
          <div class="text-center py-6 text-neutral-400">
            No variables configured yet. Add one below.
          </div>
        {:else}
          <div class="grid grid-cols-12 gap-2 pb-1.5 text-[11px] font-semibold text-neutral-500 border-b border-neutral-200 dark:border-[#303030]">
            <span class="col-span-3">Variable Name</span>
            <span class="col-span-4">Value</span>
            <span class="col-span-2">Scope</span>
            <span class="col-span-2 text-center">Secret?</span>
            <span class="col-span-1 text-center"></span>
          </div>

          {#each localVars as item (item.id)}
            <div class="grid grid-cols-12 gap-2 items-center py-1">
              <!-- Key -->
              <input
                type="text"
                bind:value={item.key}
                placeholder="VARIABLE_NAME"
                class="col-span-3 bg-neutral-50 dark:bg-[#181818] border border-neutral-300 dark:border-[#333] rounded px-2 py-1 font-mono text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-blue-500"
              />

              <!-- Value with Reveal Icon for Secrets -->
              <div class="col-span-4 relative">
                <input
                  type={item.isSecret && !revealed[item.id] ? 'password' : 'text'}
                  bind:value={item.value}
                  placeholder={item.isSecret ? 'secret value' : 'value'}
                  class="w-full bg-neutral-50 dark:bg-[#181818] border border-neutral-300 dark:border-[#333] rounded px-2 py-1 font-mono text-neutral-800 dark:text-neutral-200 pr-7 focus:outline-none focus:border-blue-500"
                />
                {#if item.isSecret}
                  <button
                    type="button"
                    onclick={() => toggleReveal(item.id)}
                    title={revealed[item.id] ? 'Hide Secret' : 'Reveal Secret'}
                    class="absolute right-2 top-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                  >
                    {#if revealed[item.id]}
                      <EyeOff size={13} />
                    {:else}
                      <Eye size={13} />
                    {/if}
                  </button>
                {/if}
              </div>

              <span class="col-span-2 text-center text-[10px] text-neutral-500">
                {item.scope === 'workspace' ? 'Workspace' : envState.activeEnvName}
              </span>

              <!-- Secret Toggle -->
              <div class="col-span-2 flex items-center justify-center">
                <label class="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    bind:checked={item.isSecret}
                    class="rounded accent-amber-500 cursor-pointer"
                  />
                  <span class="text-[11px] {item.isSecret ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-neutral-500'}">
                    {item.isSecret ? 'Secret' : 'Plain'}
                  </span>
                </label>
              </div>

              <!-- Delete -->
              <div class="col-span-1 flex justify-center">
                <button
                  type="button"
                  onclick={() => deleteVariable(item.id)}
                  title="Delete variable"
                  class="p-1 text-neutral-400 hover:text-rose-500 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          {/each}
        {/if}

        <!-- Add Variable Form Row -->
        <div class="grid grid-cols-12 gap-2 items-center pt-3 border-t border-neutral-200 dark:border-[#303030]">
          <input
            type="text"
            placeholder="New key name"
            bind:value={newKey}
            onkeydown={(e) => e.key === 'Enter' && addVariable()}
            class="col-span-3 bg-white dark:bg-[#181818] border border-neutral-300 dark:border-[#333] rounded px-2 py-1 font-mono text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:border-blue-500"
          />
          <div class="col-span-4 relative">
            <input
              type={newIsSecret ? 'password' : 'text'}
              placeholder="Variable value"
              bind:value={newValue}
              onkeydown={(e) => e.key === 'Enter' && addVariable()}
              class="w-full bg-white dark:bg-[#181818] border border-neutral-300 dark:border-[#333] rounded px-2 py-1 font-mono text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <select
            bind:value={newScope}
            onchange={() => { if (newScope === 'workspace') newIsSecret = true; }}
            class="ui-select col-span-2 px-2 py-1"
          >
            <option value="environment">Selected environment</option>
            <option value="workspace">Workspace secret</option>
          </select>
          <div class="col-span-2 flex items-center justify-center">
            <label class="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                bind:checked={newIsSecret}
                disabled={newScope === 'workspace'}
                class="rounded accent-amber-500 cursor-pointer"
              />
              <span class="text-[11px] {newIsSecret ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-neutral-500'}">
                Secret
              </span>
            </label>
          </div>
          <div class="col-span-1 flex justify-center">
            <button
              type="button"
              onclick={addVariable}
              class="flex items-center justify-center p-1 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors shadow-sm"
              title="Add Variable"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        {:else}
          {#if !collectionPath}
            <div class="text-center py-10 text-neutral-500">
              <div class="font-medium text-neutral-700 dark:text-neutral-300">Open a saved request to manage collection variables</div>
              <div class="mt-1 text-[11px]">Collection variables are stored with the request’s collection.</div>
            </div>
          {:else if isCollectionLoading}
            <div class="text-center py-10 text-neutral-500">Loading collection variables…</div>
          {:else if !hasCollection}
            <div class="text-center py-10 text-neutral-500">
              <div class="font-medium text-neutral-700 dark:text-neutral-300">This request isn’t inside a collection folder</div>
              <div class="mt-1 text-[11px]">Move or save it in a collection to manage collection variables.</div>
            </div>
          {:else}
            <div class="flex items-start justify-between gap-3 pb-2">
              <div>
                <div class="text-xs font-semibold text-neutral-800 dark:text-neutral-200">{collectionName} variables</div>
                <div class="mt-0.5 text-[11px] text-neutral-500">These override the selected environment and workspace values for requests in this collection.</div>
              </div>
              <span class="shrink-0 rounded bg-blue-500/10 px-2 py-1 text-[10px] font-medium text-blue-600 dark:text-blue-400">Saved with collection</span>
            </div>

            <div class="grid grid-cols-12 gap-2 pb-1.5 text-[11px] font-semibold text-neutral-500 border-b border-neutral-200 dark:border-[#303030]">
              <span class="col-span-4">Variable Name</span>
              <span class="col-span-5">Value</span>
              <span class="col-span-2 text-center">Secret?</span>
              <span class="col-span-1 text-center"></span>
            </div>

            {#if collectionVars.length === 0}
              <div class="text-center py-5 text-neutral-400">No collection variables yet. Add one below.</div>
            {/if}
            {#each collectionVars as item (item.id)}
              <div class="grid grid-cols-12 gap-2 items-center py-1">
                <input
                  type="text"
                  bind:value={item.key}
                  placeholder="VARIABLE_NAME"
                  aria-label="Collection variable name"
                  class="col-span-4 bg-neutral-50 dark:bg-[#181818] border border-neutral-300 dark:border-[#333] rounded px-2 py-1 font-mono text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-blue-500"
                />
                <div class="col-span-5 relative">
                  <input
                    type={item.isSecret && !revealed[item.id] ? 'password' : 'text'}
                    bind:value={item.value}
                    placeholder={item.isSecret ? 'secret value' : 'value'}
                    aria-label="Collection variable value"
                    class="w-full bg-neutral-50 dark:bg-[#181818] border border-neutral-300 dark:border-[#333] rounded px-2 py-1 font-mono text-neutral-800 dark:text-neutral-200 pr-7 focus:outline-none focus:border-blue-500"
                  />
                  {#if item.isSecret}
                    <button
                      type="button"
                      onclick={() => toggleReveal(item.id)}
                      title={revealed[item.id] ? 'Hide Secret' : 'Reveal Secret'}
                      aria-label={revealed[item.id] ? 'Hide collection secret' : 'Reveal collection secret'}
                      class="absolute right-2 top-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                    >
                      {#if revealed[item.id]}<EyeOff size={13} />{:else}<Eye size={13} />{/if}
                    </button>
                  {/if}
                </div>
                <div class="col-span-2 flex items-center justify-center">
                  <label class="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" bind:checked={item.isSecret} class="rounded accent-amber-500 cursor-pointer" />
                    <span class="text-[11px] {item.isSecret ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-neutral-500'}">{item.isSecret ? 'Secret' : 'Plain'}</span>
                  </label>
                </div>
                <div class="col-span-1 flex justify-center">
                  <button type="button" onclick={() => deleteCollectionVariable(item.id)} title="Delete collection variable" class="p-1 text-neutral-400 hover:text-rose-500 transition-colors"><Trash2 size={13} /></button>
                </div>
              </div>
            {/each}

            <div class="grid grid-cols-12 gap-2 items-center pt-3 border-t border-neutral-200 dark:border-[#303030]">
              <input
                type="text"
                placeholder="New key name"
                aria-label="New collection variable name"
                bind:value={newCollectionKey}
                onkeydown={(event) => event.key === 'Enter' && addCollectionVariable()}
                class="col-span-4 bg-white dark:bg-[#181818] border border-neutral-300 dark:border-[#333] rounded px-2 py-1 font-mono text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:border-blue-500"
              />
              <input
                type={newCollectionIsSecret ? 'password' : 'text'}
                placeholder="Variable value"
                aria-label="New collection variable value"
                bind:value={newCollectionValue}
                onkeydown={(event) => event.key === 'Enter' && addCollectionVariable()}
                class="col-span-5 bg-white dark:bg-[#181818] border border-neutral-300 dark:border-[#333] rounded px-2 py-1 font-mono text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:border-blue-500"
              />
              <div class="col-span-2 flex items-center justify-center">
                <label class="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" bind:checked={newCollectionIsSecret} class="rounded accent-amber-500 cursor-pointer" />
                  <span class="text-[11px] {newCollectionIsSecret ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-neutral-500'}">Secret</span>
                </label>
              </div>
              <div class="col-span-1 flex justify-center">
                <button type="button" onclick={addCollectionVariable} disabled={!newCollectionKey.trim()} class="flex items-center justify-center p-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded transition-colors shadow-sm" title="Add Collection Variable" aria-label="Add collection variable"><Plus size={14} /></button>
              </div>
            </div>
          {/if}
        {/if}
      </div>

      <!-- Modal Footer -->
      <div class="px-4 py-3 bg-[#f9f9fb] dark:bg-[#252526] border-t border-neutral-200 dark:border-[#333] flex items-center justify-between">
        <span class="text-[11px] text-neutral-500">
          {#if activeSection === 'collection'}
            {collectionVars.length} collection variable{collectionVars.length === 1 ? '' : 's'} ({collectionVars.filter((v) => v.isSecret).length} secret)
          {:else}
            {localVars.length} variable{localVars.length === 1 ? '' : 's'} ({localVars.filter((v) => v.isSecret).length} secret)
          {/if}
        </span>
        {#if saveError}<span role="alert" class="text-[11px] text-rose-600 dark:text-rose-400">{saveError}</span>{/if}
        <div class="flex items-center gap-2">
          <button
            onclick={() => (envState.isVariablesModalOpen = false)}
            class="px-3 py-1.5 rounded text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
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
  </div>
{/if}
