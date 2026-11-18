<script lang="ts">
  import { envState } from '$lib/state/env.svelte';
  import { workspaceState } from '$lib/state/workspace.svelte';
  import type { VariableItem } from '$lib/types';
  import { appendVariableDraft } from '$lib/utils/variable-drafts';
  import { hasDuplicateEnvironmentName, isDefaultEnvironmentName, normalizeEnvironmentName } from '$lib/utils/environment';
  import Modal from '$lib/components/ui/Modal.svelte';
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
  import {
    X,
    Eye,
    EyeOff,
    Plus,
    Trash2,
    ShieldCheck,
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
  let isCreatingEnvironment = $state(false);
  let newEnvironmentName = $state('');
  let newEnvironmentError = $state('');
  let isSavingNewEnvironment = $state(false);
  let pendingDeleteEnvironment = $state<string | null>(null);
  let isDeletingEnvironment = $state(false);
  let deleteEnvironmentError = $state('');
  let collectionLoadId = 0;
  let wasOpen = false;

  $effect(() => {
    const isOpen = envState.isVariablesModalOpen;
    const variables = envState.variables;
    if (!isOpen) {
      wasOpen = false;
      envState.collectionVariablesTargetPath = null;
      return;
    }
    localVars = variables.map((variable) => ({ ...variable }));
    if (!wasOpen) {
      revealed = {};
      newKey = '';
      newValue = '';
      newIsSecret = false;
      newScope = 'environment';
      activeSection = envState.collectionVariablesTargetPath ? 'collection' : 'environment';
      saveError = '';
      newCollectionKey = '';
      newCollectionValue = '';
      newCollectionIsSecret = false;
      isCreatingEnvironment = false;
      newEnvironmentName = '';
      newEnvironmentError = '';
      isSavingNewEnvironment = false;
      pendingDeleteEnvironment = null;
      isDeletingEnvironment = false;
      deleteEnvironmentError = '';
    }
    wasOpen = true;
  });

  $effect(() => {
    if (!envState.isVariablesModalOpen) return;
    envState.collectionVariablesRevision;
    const requestPath = envState.collectionVariablesTargetPath || workspaceState.activeTab?.filePath || '';
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
      isCollectionLoading = false;
    }).catch(() => {
      if (loadId === collectionLoadId) isCollectionLoading = false;
    });
  });

  function toggleReveal(id: string) {
    revealed[id] = !revealed[id];
  }

  function addVariable() {
    if (!newKey.trim()) return;
    localVars = appendVariableDraft(
      localVars,
      { key: newKey, value: newValue, isSecret: newIsSecret, scope: newScope },
      `var-${Date.now()}-${Math.random()}`,
    );
    newKey = '';
    newValue = '';
    newIsSecret = false;
  }

  function removeVariable(id: string) {
    localVars = localVars.filter((v) => v.id !== id);
  }

  function addCollectionVariable() {
    if (!newCollectionKey.trim() || !collectionPath) return;
    collectionVars = appendVariableDraft(
      collectionVars,
      { key: newCollectionKey, value: newCollectionValue, isSecret: newCollectionIsSecret, scope: 'collection' },
      `col-${Date.now()}-${Math.random()}`,
    );
    newCollectionKey = '';
    newCollectionValue = '';
    newCollectionIsSecret = false;
  }

  function removeCollectionVariable(id: string) {
    collectionVars = collectionVars.filter((v) => v.id !== id);
  }

  async function submitNewEnvironment() {
    const name = normalizeEnvironmentName(newEnvironmentName);
    if (!name) {
      newEnvironmentError = 'Enter an environment name.';
      return;
    }
    if (hasDuplicateEnvironmentName(envState.environments, name)) {
      newEnvironmentError = `Environment "${name}" already exists.`;
      return;
    }

    isSavingNewEnvironment = true;
    newEnvironmentError = '';
    try {
      await envState.createEnvironment(name);
      isCreatingEnvironment = false;
      newEnvironmentName = '';
    } catch (error) {
      newEnvironmentError = error instanceof Error ? error.message : String(error);
    } finally {
      isSavingNewEnvironment = false;
    }
  }

  async function submitDeleteEnvironment() {
    if (!pendingDeleteEnvironment || isDeletingEnvironment) return;
    const name = pendingDeleteEnvironment;
    isDeletingEnvironment = true;
    deleteEnvironmentError = '';
    try {
      await envState.deleteEnvironment(name);
      pendingDeleteEnvironment = null;
    } catch (error) {
      deleteEnvironmentError = error instanceof Error ? error.message : String(error);
    } finally {
      isDeletingEnvironment = false;
    }
  }

  async function handleSave() {
    saveError = '';
    try {
      addVariable();
      addCollectionVariable();
      await envState.updateVariables(localVars);
      if (collectionPath && (hasCollection || envState.collectionVariablesTargetPath)) {
        await envState.updateCollectionVariables(collectionPath, collectionVars);
      }
      envState.closeVariablesModal();
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<Modal
  isOpen={envState.isVariablesModalOpen}
  title="Variables & Secrets"
  maxWidth="2xl"
  onclose={() => envState.closeVariablesModal()}
>
  {#snippet icon()}
    <span class="font-mono font-bold text-xs">&#123;x&#125;</span>
  {/snippet}

  {#snippet headerActions()}
    <div class="flex items-center gap-1">
      <select
        aria-label="Active environment"
        value={envState.activeEnvName}
        onchange={(event) => envState.selectEnvironment(event.currentTarget.value)}
        class="ui-select max-w-40 px-2 py-0.5 text-[11px]"
      >
        {#each envState.environments as environment}
          <option value={environment.name}>{environment.name}</option>
        {/each}
      </select>
      <button
        type="button"
        onclick={() => {
          isCreatingEnvironment = !isCreatingEnvironment;
          pendingDeleteEnvironment = null;
          deleteEnvironmentError = '';
          newEnvironmentName = '';
          newEnvironmentError = '';
        }}
        title="Create environment"
        aria-label="Create environment"
        class="ui-icon-button"
      >
        <Plus size={13} />
      </button>
      <button
        type="button"
        onclick={() => {
          pendingDeleteEnvironment = envState.activeEnvName;
          isCreatingEnvironment = false;
          newEnvironmentName = '';
          newEnvironmentError = '';
          deleteEnvironmentError = '';
        }}
        disabled={isDefaultEnvironmentName(envState.activeEnvName) || isDeletingEnvironment}
        title={isDefaultEnvironmentName(envState.activeEnvName) ? 'The default environment cannot be deleted' : `Delete ${envState.activeEnvName}`}
        aria-label="Delete environment"
        class="ui-icon-button text-[var(--danger)] disabled:opacity-40"
      >
        <Trash2 size={13} />
      </button>
    </div>
  {/snippet}

  <div class="flex flex-col text-xs">
    {#if pendingDeleteEnvironment}
      <div
        role="alertdialog"
        aria-label="Delete environment"
        class="border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--danger)_6%,var(--surface-muted))] px-4 py-2"
      >
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 text-[11px] text-[var(--text-strong)]">
            Delete <span class="font-semibold">"{pendingDeleteEnvironment}"</span> and its secrets?
          </span>
          <button
            type="button"
            onclick={() => {
              pendingDeleteEnvironment = null;
              deleteEnvironmentError = '';
            }}
            disabled={isDeletingEnvironment}
            class="ui-button ui-button-secondary h-7 px-2 text-[10px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={() => void submitDeleteEnvironment()}
            disabled={isDeletingEnvironment}
            class="ui-button ui-button-danger h-7 px-2 text-[10px]"
          >
            {isDeletingEnvironment ? 'Deleting...' : 'Delete'}
          </button>
        </div>
        {#if deleteEnvironmentError}
          <p role="alert" class="mt-1.5 text-[10px] text-[var(--danger)]">{deleteEnvironmentError}</p>
        {/if}
      </div>
    {/if}

    {#if isCreatingEnvironment}
      <form
        class="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2"
        onsubmit={(event) => {
          event.preventDefault();
          void submitNewEnvironment();
        }}
      >
        <div class="flex items-center gap-2">
          <input
            aria-label="New environment name"
            bind:value={newEnvironmentName}
            disabled={isSavingNewEnvironment}
            placeholder="Environment name"
            class="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--text-strong)] outline-none focus:border-[var(--focus)]"
          />
          <button
            type="button"
            onclick={() => {
              isCreatingEnvironment = false;
              newEnvironmentName = '';
              newEnvironmentError = '';
            }}
            disabled={isSavingNewEnvironment}
            class="ui-button ui-button-secondary h-7 px-2 text-[10px]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSavingNewEnvironment || !normalizeEnvironmentName(newEnvironmentName)}
            class="ui-button ui-button-primary h-7 px-2 text-[10px]"
          >
            {isSavingNewEnvironment ? 'Creating...' : 'Create'}
          </button>
        </div>
        {#if newEnvironmentError}
          <p role="alert" class="mt-1.5 text-[10px] text-[var(--danger)]">{newEnvironmentError}</p>
        {/if}
      </form>
    {/if}

    <!-- Notice -->
    <div class="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2 text-[11px] text-[var(--text-muted)]">
      <div class="flex items-center gap-1.5">
        <ShieldCheck size={13} class="text-[var(--warning)] shrink-0" />
        <span>Selected environment overrides workspace secrets. Collection variables override both.</span>
      </div>
      <span class="font-mono text-[10px] text-[var(--text-subtle)]">Use as &#123;&#123;variable&#125;&#125;</span>
    </div>

    <!-- Scopes Switch -->
    <div class="border-b border-[var(--border)] px-4 py-2 bg-[var(--surface)]">
      <SegmentedControl
        items={[
          { id: 'environment', label: `Environment (${envState.activeEnvName})`, count: localVars.length },
          { id: 'collection', label: `Collection${collectionName ? ` · ${collectionName}` : ''}`, count: collectionVars.length },
        ]}
        activeId={activeSection}
        onchange={(id) => (activeSection = id as typeof activeSection)}
        size="sm"
      />
    </div>

    <!-- Variables Table -->
    <div class="p-4 flex-1 overflow-y-auto space-y-2 bg-[var(--surface)] max-h-[50vh]">
      {#if activeSection === 'environment'}
        {#if localVars.length === 0}
          <div class="text-center py-8 text-[var(--text-subtle)] text-[11px]">
            No variables configured for {envState.activeEnvName}. Add one below.
          </div>
        {:else}
          <div class="grid grid-cols-12 gap-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-subtle)] border-b border-[var(--border)]">
            <span class="col-span-4">Variable Name</span>
            <span class="col-span-4">Value</span>
            <span class="col-span-2">Scope</span>
            <span class="col-span-1 text-center">Secret</span>
            <span class="col-span-1"></span>
          </div>

          {#each localVars as item (item.id)}
            <div class="grid grid-cols-12 gap-2 items-center py-0.5">
              <input
                type="text"
                bind:value={item.key}
                placeholder="VARIABLE_NAME"
                class="col-span-4 bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2 py-1 font-mono text-xs text-[var(--text-strong)] outline-none"
              />
              <div class="col-span-4 relative">
                <input
                  type={item.isSecret && !revealed[item.id] ? 'password' : 'text'}
                  bind:value={item.value}
                  placeholder={item.isSecret ? 'secret value' : 'value'}
                  class="w-full bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2 py-1 font-mono text-xs text-[var(--text-strong)] pr-6 outline-none"
                />
                {#if item.isSecret}
                  <button
                    type="button"
                    onclick={() => toggleReveal(item.id)}
                    title={revealed[item.id] ? 'Hide Secret' : 'Reveal Secret'}
                    aria-label={revealed[item.id] ? 'Hide secret' : 'Reveal secret'}
                    class="absolute right-1.5 top-1 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                  >
                    {#if revealed[item.id]}<EyeOff size={12} />{:else}<Eye size={12} />{/if}
                  </button>
                {/if}
              </div>
              <span class="col-span-2 text-[10px] text-[var(--text-muted)] truncate">
                {item.scope === 'workspace' ? 'Workspace' : envState.activeEnvName}
              </span>
              <div class="col-span-1 text-center">
                <input type="checkbox" bind:checked={item.isSecret} onchange={(event) => {
                  if (!event.currentTarget.checked) delete revealed[item.id];
                }} class="rounded accent-[var(--accent)]" />
              </div>
              <div class="col-span-1 text-right">
                <button
                  type="button"
                  onclick={() => removeVariable(item.id)}
                  aria-label="Remove variable"
                  class="text-[var(--text-muted)] hover:text-[var(--danger)]"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          {/each}
        {/if}

        <!-- Add Variable Row -->
        <div class="mt-3 pt-3 border-t border-[var(--border)]">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-subtle)] mb-2">Add Variable</div>
          <div class="grid grid-cols-12 gap-2 items-center">
            <input
              type="text"
              bind:value={newKey}
              placeholder="VARIABLE_NAME"
              class="col-span-4 bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2 py-1 font-mono text-xs text-[var(--text-strong)] outline-none"
            />
            <input
              type="text"
              bind:value={newValue}
              placeholder="Value"
              class="col-span-4 bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2 py-1 font-mono text-xs text-[var(--text-strong)] outline-none"
            />
            <select
              bind:value={newScope}
              class="col-span-2 ui-select px-1.5 py-1 text-[11px]"
            >
              <option value="environment">{envState.activeEnvName}</option>
              <option value="workspace">Workspace</option>
            </select>
            <label class="col-span-1 flex items-center justify-center gap-1 text-[10px] text-[var(--text-muted)] cursor-pointer">
              <input type="checkbox" bind:checked={newIsSecret} class="rounded accent-[var(--accent)]" />
            </label>
            <div class="col-span-1 text-right">
              <button
                type="button"
                onclick={addVariable}
                disabled={!newKey.trim()}
                class="ui-button ui-button-secondary h-6.5 px-2 text-[10px] disabled:opacity-40"
              >
                <Plus size={11} />
              </button>
            </div>
          </div>
        </div>
      {:else}
        <!-- Collection Scope Tab -->
        {#if !hasCollection}
          <div class="text-center py-8 text-[var(--text-subtle)] text-[11px]">
            The current active request is not inside a collection folder.
          </div>
        {:else}
          {#if collectionVars.length === 0}
            <div class="text-center py-8 text-[var(--text-subtle)] text-[11px]">
              No collection variables defined for {collectionName}.
            </div>
          {:else}
            <div class="grid grid-cols-12 gap-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-subtle)] border-b border-[var(--border)]">
              <span class="col-span-5">Variable Name</span>
              <span class="col-span-5">Value</span>
              <span class="col-span-1 text-center">Secret</span>
              <span class="col-span-1"></span>
            </div>

            {#each collectionVars as item (item.id)}
              <div class="grid grid-cols-12 gap-2 items-center py-0.5">
                <input
                  type="text"
                  bind:value={item.key}
                  class="col-span-5 bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2 py-1 font-mono text-xs text-[var(--text-strong)] outline-none"
                />
                <div class="col-span-5 relative">
                  <input
                    type={item.isSecret && !revealed[item.id] ? 'password' : 'text'}
                    bind:value={item.value}
                    class="w-full bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2 py-1 pr-6 font-mono text-xs text-[var(--text-strong)] outline-none"
                  />
                  {#if item.isSecret}
                    <button
                      type="button"
                      onclick={() => toggleReveal(item.id)}
                      title={revealed[item.id] ? 'Hide Secret' : 'Reveal Secret'}
                      aria-label={revealed[item.id] ? 'Hide secret' : 'Reveal secret'}
                      class="absolute right-1.5 top-1 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                    >
                      {#if revealed[item.id]}<EyeOff size={12} />{:else}<Eye size={12} />{/if}
                    </button>
                  {/if}
                </div>
                <div class="col-span-1 text-center">
                  <input type="checkbox" bind:checked={item.isSecret} onchange={(event) => {
                    if (!event.currentTarget.checked) delete revealed[item.id];
                  }} class="rounded accent-[var(--accent)]" />
                </div>
                <div class="col-span-1 text-right">
                  <button
                    type="button"
                    onclick={() => removeCollectionVariable(item.id)}
                    aria-label="Remove collection variable"
                    class="text-[var(--text-muted)] hover:text-[var(--danger)]"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            {/each}
          {/if}

          <!-- Add Collection Variable Row -->
          <div class="mt-3 pt-3 border-t border-[var(--border)]">
            <div class="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-subtle)] mb-2">Add Collection Variable</div>
            <div class="grid grid-cols-12 gap-2 items-center">
              <input
                type="text"
                bind:value={newCollectionKey}
                placeholder="COLLECTION_VAR"
                class="col-span-5 bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2 py-1 font-mono text-xs text-[var(--text-strong)] outline-none"
              />
              <input
                type="text"
                bind:value={newCollectionValue}
                placeholder="Value"
                class="col-span-5 bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2 py-1 font-mono text-xs text-[var(--text-strong)] outline-none"
              />
              <label class="col-span-1 flex items-center justify-center gap-1 text-[10px] text-[var(--text-muted)] cursor-pointer">
                <input type="checkbox" bind:checked={newCollectionIsSecret} class="rounded accent-[var(--accent)]" />
              </label>
              <div class="col-span-1 text-right">
                <button
                  type="button"
                  onclick={addCollectionVariable}
                  disabled={!newCollectionKey.trim()}
                  class="ui-button ui-button-secondary h-6.5 px-2 text-[10px] disabled:opacity-40"
                >
                  <Plus size={11} />
                </button>
              </div>
            </div>
          </div>
        {/if}
      {/if}
    </div>

    {#if saveError}
      <p role="alert" class="px-4 py-1.5 text-[11px] text-[var(--danger)] border-t border-[var(--border)]">{saveError}</p>
    {/if}
  </div>

  {#snippet footer()}
    <button
      type="button"
      onclick={() => envState.closeVariablesModal()}
      class="ui-button ui-button-secondary h-7 px-3 text-[11px]"
    >
      Cancel
    </button>
    <button
      type="button"
      onclick={handleSave}
      class="ui-button ui-button-primary h-7 px-3 text-[11px]"
    >
      Save Changes
    </button>
  {/snippet}
</Modal>
