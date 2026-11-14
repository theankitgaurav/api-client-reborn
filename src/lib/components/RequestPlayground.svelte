<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { envState } from '$lib/state/env.svelte';
  import { responseState } from '$lib/state/response.svelte';
  import { shortcutsState } from '$lib/state/shortcuts.svelte';
  import { registerBeautifyHandler } from '$lib/utils/shortcuts';
  import {
    parseCurlToPlayground,
    serializePlaygroundToCurl,
    type PlaygroundModel,
  } from '$lib/utils/curl-serializer';
  import {
    getVariableAtPosition,
    getVariableInfo,
    type VariableInfo,
  } from '$lib/utils/variable-tooltip';
  import {
    Play,
    Square,
    Save,
    Copy,
    Check,
    Plus,
    Trash2,
    Eye,
    EyeOff,
  } from '$lib/components/icons';
  import { getResolvedCommand } from '$lib/utils/curl-generator';

  let activeTab = $state<'params' | 'headers' | 'body' | 'auth' | 'scripts'>('params');
  let scriptSubTab = $state<'pre' | 'post'>('pre');
  let preRequestScript = $state('');
  let postResponseScript = $state('');
  let copiedCurl = $state(false);
  let copyResetTimeout: ReturnType<typeof setTimeout> | null = null;
  let showBasicPassword = $state(false);

  let model = $state<PlaygroundModel>(parseCurlToPlayground(''));
  let tooltipVariables = $state<Record<string, string>>({});
  let tooltipCollectionVariables = $state<Set<string>>(new Set());
  let tooltipCollectionSecrets = $state<Set<string>>(new Set());

  let isMac = $derived(shortcutsState.isMac);

  $effect(() => {
    workspaceState.activeTabId;
    showBasicPassword = false;
  });

  $effect(() => {
    registerBeautifyHandler(() => {
      if (model.bodyType === 'json') {
        beautifyJson();
      }
    });
    return () => registerBeautifyHandler(null);
  });

  $effect(() => {
    const filePath = workspaceState.activeTab?.filePath;
    envState.collectionVariablesRevision;
    void Promise.all([
      envState.variablesForRequest(filePath),
      filePath ? envState.collectionVariablesForRequest(filePath) : Promise.resolve(null),
    ]).then(([variables, collection]) => {
      tooltipVariables = variables;
      tooltipCollectionVariables = new Set([
        ...Object.keys(collection?.public_vars || {}),
        ...Object.keys(collection?.secret_vars || {}),
      ]);
      tooltipCollectionSecrets = new Set(Object.keys(collection?.secret_vars || {}));
    });
  });

  // Whenever the active tab changes from workspace, load into model & scripts
  $effect(() => {
    const tab = workspaceState.activeTab;
    if (tab) {
      model = parseCurlToPlayground(tab.rawContent);
      preRequestScript = tab.sidecar?.pre_request_script || '';
      postResponseScript = tab.sidecar?.post_response_script || '';
    }
  });

  // Re-serialize back to workspace raw_content whenever the request model changes
  function syncToWorkspace() {
    if (workspaceState.activeTab) {
      const serialized = serializePlaygroundToCurl(model);
      workspaceState.updateContent(serialized, model.method, model.name);
    }
  }

  function handleRequestMethodChange(event: Event) {
    const method = (event.target as HTMLSelectElement).value;
    if (method === 'gRPC') {
      workspaceState.switchRequestType('grpc');
      return;
    }

    model.method = method;
    syncToWorkspace();
  }

  function syncScriptsToWorkspace() {
    const tab = workspaceState.activeTab;
    if (!tab) return;
    if (!tab.sidecar) {
      tab.sidecar = { tests: [] };
    }
    tab.sidecar.pre_request_script = preRequestScript;
    tab.sidecar.post_response_script = postResponseScript;
    tab.isDirty = true;
    tab.isPinned = true;
  }

  async function copyCurl() {
    const activeTab = workspaceState.activeTab;
    const rawContent = activeTab?.rawContent || serializePlaygroundToCurl(model);
    const variables = await envState.variablesForRequest(activeTab?.filePath);
    const command = getResolvedCommand(rawContent, variables);
    await navigator.clipboard.writeText(command);
    copiedCurl = true;
    if (copyResetTimeout) clearTimeout(copyResetTimeout);
    copyResetTimeout = setTimeout(() => (copiedCurl = false), 1500);
  }

  function insertSnippet(code: string) {
    if (scriptSubTab === 'pre') {
      preRequestScript = (preRequestScript.trim() ? preRequestScript.trim() + '\n\n' : '') + code;
    } else {
      postResponseScript = (postResponseScript.trim() ? postResponseScript.trim() + '\n\n' : '') + code;
    }
    syncScriptsToWorkspace();
  }

  // Handle URL input changes: sync query params into params table
  function handleUrlInput(newUrl: string) {
    model.url = newUrl;
    const questionIdx = newUrl.indexOf('?');
    if (questionIdx >= 0) {
      const baseUrl = newUrl.substring(0, questionIdx);
      const queryStr = newUrl.substring(questionIdx + 1);
      const newParams = [];

      for (const pair of queryStr.split('&')) {
        if (!pair) continue;
        const [k, v] = pair.split('=');
        newParams.push({
          id: String(Date.now() + Math.random()),
          key: decodeURIComponent(k || ''),
          value: decodeURIComponent(v || ''),
          enabled: true,
        });
      }
      model.url = baseUrl;
      if (newParams.length > 0) {
        model.params = newParams;
      }
    }
    syncToWorkspace();
  }

  // Params Table Actions
  function addParam() {
    model.params.push({
      id: String(Date.now() + Math.random()),
      key: '',
      value: '',
      enabled: true,
    });
    syncToWorkspace();
  }

  function deleteParam(id: string) {
    model.params = model.params.filter((p) => p.id !== id);
    if (model.params.length === 0) addParam();
    syncToWorkspace();
  }

  // Headers Table Actions
  function addHeader() {
    model.headers.push({
      id: String(Date.now() + Math.random()),
      key: '',
      value: '',
      enabled: true,
    });
    syncToWorkspace();
  }

  function deleteHeader(id: string) {
    model.headers = model.headers.filter((h) => h.id !== id);
    if (model.headers.length === 0) addHeader();
    syncToWorkspace();
  }

  // Form Data Actions
  function addFormParam() {
    model.bodyUrlencoded.push({
      id: String(Date.now() + Math.random()),
      key: '',
      value: '',
      enabled: true,
    });
    syncToWorkspace();
  }

  async function chooseFormFile(id: string) {
    try {
      let selected: string | null = null;
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const result = await open({ multiple: false });
        selected = typeof result === 'string' ? result : null;
      } else {
        selected = window.prompt('Enter the path to the file to upload:');
      }
      if (!selected) return;
      const field = model.bodyUrlencoded.find((item) => item.id === id);
      if (!field) return;
      field.value = selected;
      field.isFile = true;
      syncToWorkspace();
    } catch (error) {
      alert(`Could not select upload file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function deleteFormParam(id: string) {
    model.bodyUrlencoded = model.bodyUrlencoded.filter((p) => p.id !== id);
    if (model.bodyUrlencoded.length === 0) addFormParam();
    syncToWorkspace();
  }

  function beautifyJson() {
    try {
      const parsed = JSON.parse(model.bodyRaw);
      model.bodyRaw = JSON.stringify(parsed, null, 2);
      syncToWorkspace();
    } catch {
      // Ignore if invalid JSON
    }
  }


  async function handleSend() {
    if (responseState.isExecuting) {
      await responseState.cancel();
    } else {
      await responseState.runCurrentRequest();
    }
  }

  function getMethodColor(m: string) {
    switch (m.toUpperCase()) {
      case 'GET':
        return 'method-get-text font-bold';
      case 'POST':
        return 'method-post-text font-bold';
      case 'PUT':
        return 'method-put-text font-bold';
      case 'DELETE':
        return 'method-delete-text font-bold';
      case 'PATCH':
        return 'method-patch-text font-bold';
      case 'GRPC':
        return 'method-grpc-text font-bold';
      default:
        return 'text-[var(--text-muted)] font-bold';
    }
  }

  // --- Variable Hover Tooltip Logic ---
  interface VarTooltipData extends VariableInfo {
    visible: boolean;
    x: number;
    y: number;
    placement: 'top' | 'bottom';
  }

  let varTooltip = $state<VarTooltipData | null>(null);
  let activeHoverToken = $state<string | null>(null);
  let activeHoverInfo = $state<VariableInfo | null>(null);
  let revealedTooltipSecrets = $state<Record<string, boolean>>({});
  let isAltPressed = $state(false);
  let tooltipLeaveTimeout: ReturnType<typeof setTimeout> | null = null;
  let isHoveringTooltip = false;

  function handleWindowKeyDown(e: KeyboardEvent) {
    if (e.key === 'Alt') {
      isAltPressed = true;
    }
  }

  function handleWindowKeyUp(e: KeyboardEvent) {
    if (e.key === 'Alt') {
      isAltPressed = false;
    }
  }

  function handleVarHover(e: MouseEvent, text: string) {
    if (tooltipLeaveTimeout) {
      clearTimeout(tooltipLeaveTimeout);
      tooltipLeaveTimeout = null;
    }

    if (!text || !text.includes('{{')) {
      varTooltip = null;
      activeHoverToken = null;
      activeHoverInfo = null;
      return;
    }

    const target = e.currentTarget as HTMLElement;
    const match = getVariableAtPosition({
      text,
      clientX: e.clientX,
      clientY: e.clientY,
      target,
    });

    if (!match) {
      // Cursor is not hovering over any variable declaration: instantly dismiss tooltip
      varTooltip = null;
      activeHoverToken = null;
      activeHoverInfo = null;
      return;
    }

    // Resolve info, keeping cached value for dynamic generators while hovering the same token
    let info: VariableInfo;
    if (activeHoverToken === match.name && activeHoverInfo) {
      info = activeHoverInfo;
    } else {
      info = getVariableInfo(
        match.name,
        envState.variables,
        tooltipVariables,
        tooltipCollectionVariables,
        tooltipCollectionSecrets
      );
      activeHoverToken = match.name;
      activeHoverInfo = info;
    }

    const tooltipWidth = 280;
    const tooltipHeight = 110;
    const posX = Math.max(12, Math.min(e.clientX - 20, window.innerWidth - tooltipWidth - 16));

    let posY = e.clientY - 10;
    let placement: 'top' | 'bottom' = 'top';

    // If too close to top of viewport, place tooltip below cursor
    if (e.clientY < tooltipHeight + 20) {
      posY = e.clientY + 18;
      placement = 'bottom';
    }

    varTooltip = {
      visible: true,
      x: posX,
      y: posY,
      placement,
      ...info,
    };
  }

  function handleVarLeave() {
    if (tooltipLeaveTimeout) clearTimeout(tooltipLeaveTimeout);
    tooltipLeaveTimeout = setTimeout(() => {
      if (!isHoveringTooltip) {
        varTooltip = null;
        activeHoverToken = null;
        activeHoverInfo = null;
      }
    }, 180);
  }

  function onTooltipMouseEnter() {
    if (tooltipLeaveTimeout) {
      clearTimeout(tooltipLeaveTimeout);
      tooltipLeaveTimeout = null;
    }
    isHoveringTooltip = true;
  }

  function onTooltipMouseLeave() {
    isHoveringTooltip = false;
    varTooltip = null;
    activeHoverToken = null;
    activeHoverInfo = null;
  }
</script>

<svelte:window onkeydown={handleWindowKeyDown} onkeyup={handleWindowKeyUp} />

<div class="contents">
  <!-- Top Request Metadata & Toolbar -->
  <div class="col-span-3 row-start-1 flex min-w-0 flex-col overflow-hidden">
    <div class="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5">
      <div class="mr-2 flex min-w-0 flex-1 items-center gap-2">
        <input
          type="text"
          bind:value={model.name}
          oninput={syncToWorkspace}
          placeholder="Request Name"
          class="w-64 min-w-0 bg-transparent px-2 py-0.5 text-xs font-semibold text-[var(--text-strong)] rounded hover:bg-[var(--surface-hover)] focus:bg-[var(--surface)] border border-transparent focus:border-[var(--border)] outline-none transition-colors"
        />
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <button
          onclick={copyCurl}
          title="Copy as cURL"
          class="ui-button ui-button-secondary h-6.5 px-2.5 text-[11px]"
        >
          {#if copiedCurl}<Check size={11} class="text-[var(--success)]" /><span>Copied</span>{:else}<Copy size={11} /><span>cURL</span>{/if}
        </button>
        {#if workspaceState.isDirty || !workspaceState.activeTab?.filePath}
          <button
            onclick={() => workspaceState.saveActiveFile()}
            class="ui-button ui-button-primary h-6.5 px-2.5 text-[11px]"
          >
            <Save size={11} />
            <span>Save ({isMac ? '⌘S' : 'Ctrl+S'})</span>
          </button>
        {/if}
      </div>
    </div>

  <!-- Primary Postman Request Bar (Method + URL + Send) -->
  <div class="flex min-w-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] p-2.5">
    <!-- Method Selector -->
    <div class="relative shrink-0">
      <select
        value={model.method}
        onchange={handleRequestMethodChange}
        class="ui-select h-8 px-2.5 font-mono text-xs cursor-pointer font-bold {getMethodColor(model.method)}"
      >
        <option value="GET" class="method-get-text font-bold">GET</option>
        <option value="POST" class="method-post-text font-bold">POST</option>
        <option value="PUT" class="method-put-text font-bold">PUT</option>
        <option value="DELETE" class="method-delete-text font-bold">DELETE</option>
        <option value="PATCH" class="text-purple-500 font-bold">PATCH</option>
        <option value="HEAD" class="text-[var(--text-muted)] font-bold">HEAD</option>
        <option value="OPTIONS" class="text-[var(--text-muted)] font-bold">OPTIONS</option>
        <option value="gRPC" class="text-cyan-500 font-bold">gRPC</option>
      </select>
    </div>

    <!-- URL Bar -->
    <div class="relative min-w-0 flex-1">
      <input
        id="request-url-input"
        type="text"
        value={model.url}
        oninput={(e) => handleUrlInput((e.target as HTMLInputElement).value)}
        onmousemove={(e) => handleVarHover(e, model.url)}
        onmouseleave={handleVarLeave}
        onblur={handleVarLeave}
        title="Request URL ({isMac ? '⌘L' : 'Ctrl+L'})"
        placeholder={"Enter request URL (e.g. {{base_url}}/users or https://api.example.com)"}
        class="h-8 w-full bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-3 font-mono text-xs text-[var(--text-strong)] placeholder:text-[var(--text-subtle)] outline-none transition-colors"
      />
    </div>

    <!-- Send Button -->
    <button
      onclick={handleSend}
      class="ui-button h-8 px-4 text-xs font-semibold text-white shadow-sm transition-all active:scale-[0.98] {responseState.isExecuting
        ? 'bg-[var(--danger)] hover:bg-[var(--danger-hover)]'
        : 'bg-[var(--accent)] hover:bg-[var(--accent-strong)]'}"
    >
      {#if responseState.isExecuting}
        <Square size={12} fill="currentColor" />
        <span>Cancel</span>
      {:else}
        <Play size={12} fill="currentColor" />
        <span>Send</span>
        <span class="text-[10px] opacity-75 font-mono ml-0.5">{isMac ? '⌘↵' : 'Ctrl+↵'}</span>
      {/if}
    </button>
  </div>
  </div>

  <!-- Playground Tabs (Params | Headers | Body | Auth | Scripts) -->
  <div class="col-start-1 row-start-2 flex select-none items-center gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-3 text-xs">
    <button
      onclick={() => (activeTab = 'params')}
      class="px-2.5 py-2 font-medium border-b-2 transition-colors {activeTab === 'params'
        ? 'border-[var(--accent)] text-[var(--text-strong)] font-semibold'
        : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]'}"
    >
      Params {#if model.params.filter((p) => p.enabled && p.key).length > 0}
        <span class="ml-1 px-1.5 py-0.2 rounded-full text-[9px] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)] font-mono font-bold">
          {model.params.filter((p) => p.enabled && p.key).length}
        </span>
      {/if}
    </button>

    <button
      onclick={() => (activeTab = 'headers')}
      class="px-2.5 py-2 font-medium border-b-2 transition-colors {activeTab === 'headers'
        ? 'border-[var(--accent)] text-[var(--text-strong)] font-semibold'
        : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]'}"
    >
      Headers {#if model.headers.filter((h) => h.enabled && h.key).length > 0}
        <span class="ml-1 px-1.5 py-0.2 rounded-full text-[9px] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)] font-mono font-bold">
          {model.headers.filter((h) => h.enabled && h.key).length}
        </span>
      {/if}
    </button>

    <button
      onclick={() => (activeTab = 'body')}
      class="px-2.5 py-2 font-medium border-b-2 transition-colors {activeTab === 'body'
        ? 'border-[var(--accent)] text-[var(--text-strong)] font-semibold'
        : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]'}"
    >
      Body {#if model.bodyType !== 'none'}
        <span class="w-1.5 h-1.5 rounded-full bg-[var(--success)] inline-block ml-1"></span>
      {/if}
    </button>

    <button
      onclick={() => (activeTab = 'auth')}
      class="px-2.5 py-2 font-medium border-b-2 transition-colors {activeTab === 'auth'
        ? 'border-[var(--accent)] text-[var(--text-strong)] font-semibold'
        : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]'}"
    >
      Auth {#if model.authType !== 'none'}
        <span class="w-1.5 h-1.5 rounded-full bg-[var(--warning)] inline-block ml-1"></span>
      {/if}
    </button>

    <button
      onclick={() => (activeTab = 'scripts')}
      class="px-2.5 py-2 font-medium border-b-2 transition-colors {activeTab === 'scripts'
        ? 'border-[var(--accent)] text-[var(--text-strong)] font-semibold'
        : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]'}"
    >
      Scripts
      {#if preRequestScript.trim() || postResponseScript.trim()}
        <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] inline-block ml-1"></span>
      {/if}
    </button>
  </div>

  <!-- Tab Content Body -->
  <div class="col-start-1 row-start-3 flex min-h-0 flex-col overflow-hidden bg-[var(--surface)]">
    <!-- 1. PARAMS TAB -->
    {#if activeTab === 'params'}
      <div class="flex-1 overflow-y-auto p-3">
        <div class="text-[10px] font-semibold text-[var(--text-subtle)] mb-2 uppercase tracking-wider">
          Query Parameters
        </div>
        <table class="w-full text-left font-mono text-xs">
          <thead>
            <tr class="text-[var(--text-subtle)] border-b border-[var(--border)]">
              <th class="w-8 pb-1.5"></th>
              <th class="pb-1.5 font-medium">Key</th>
              <th class="pb-1.5 font-medium">Value</th>
              <th class="w-8 pb-1.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-subtle)]">
            {#each model.params as param}
              <tr class="hover:bg-[var(--surface-hover)] group transition-colors">
                <td class="py-1 text-center">
                  <input
                    type="checkbox"
                    bind:checked={param.enabled}
                    onchange={syncToWorkspace}
                    class="rounded accent-[var(--accent)]"
                  />
                </td>
                <td class="py-1 pr-2">
                  <input
                    type="text"
                    placeholder="Key"
                    bind:value={param.key}
                    oninput={syncToWorkspace}
                    onmousemove={(e) => handleVarHover(e, param.key)}
                    onmouseleave={handleVarLeave}
                    onblur={handleVarLeave}
                    class="w-full bg-transparent border-b border-transparent hover:border-[var(--border-strong)] focus:border-[var(--focus)] px-1 py-0.5 outline-none text-[var(--text-strong)]"
                  />
                </td>
                <td class="py-1 pr-2">
                  <input
                    type="text"
                    placeholder={"Value (or {{variable}})"}
                    bind:value={param.value}
                    oninput={syncToWorkspace}
                    onmousemove={(e) => handleVarHover(e, param.value)}
                    onmouseleave={handleVarLeave}
                    onblur={handleVarLeave}
                    class="w-full bg-transparent border-b border-transparent hover:border-[var(--border-strong)] focus:border-[var(--focus)] px-1 py-0.5 outline-none text-[var(--text-strong)]"
                  />
                </td>
                <td class="py-1 text-center">
                  <button
                    onclick={() => deleteParam(param.id)}
                    class="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--danger)] transition-opacity"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <button
          onclick={addParam}
          class="mt-2.5 flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
        >
          <Plus size={13} />
          <span>Add Parameter</span>
        </button>
      </div>

    <!-- 2. HEADERS TAB -->
    {:else if activeTab === 'headers'}
      <div class="flex-1 overflow-y-auto p-3">
        <div class="text-[10px] font-semibold text-[var(--text-subtle)] mb-2 uppercase tracking-wider">
          Request Headers
        </div>
        <table class="w-full text-left font-mono text-xs">
          <thead>
            <tr class="text-[var(--text-subtle)] border-b border-[var(--border)]">
              <th class="w-8 pb-1.5"></th>
              <th class="pb-1.5 font-medium">Header Name</th>
              <th class="pb-1.5 font-medium">Header Value</th>
              <th class="w-8 pb-1.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-subtle)]">
            {#each model.headers as h}
              <tr class="hover:bg-[var(--surface-hover)] group transition-colors">
                <td class="py-1 text-center">
                  <input
                    type="checkbox"
                    bind:checked={h.enabled}
                    onchange={syncToWorkspace}
                    class="rounded accent-[var(--accent)]"
                  />
                </td>
                <td class="py-1 pr-2">
                  <input
                    type="text"
                    placeholder="Header Name"
                    bind:value={h.key}
                    oninput={syncToWorkspace}
                    onmousemove={(e) => handleVarHover(e, h.key)}
                    onmouseleave={handleVarLeave}
                    onblur={handleVarLeave}
                    class="w-full bg-transparent border-b border-transparent hover:border-[var(--border-strong)] focus:border-[var(--focus)] px-1 py-0.5 outline-none text-[var(--text-strong)]"
                  />
                </td>
                <td class="py-1 pr-2">
                  <input
                    type="text"
                    placeholder="Header Value"
                    bind:value={h.value}
                    oninput={syncToWorkspace}
                    onmousemove={(e) => handleVarHover(e, h.value)}
                    onmouseleave={handleVarLeave}
                    onblur={handleVarLeave}
                    class="w-full bg-transparent border-b border-transparent hover:border-[var(--border-strong)] focus:border-[var(--focus)] px-1 py-0.5 outline-none text-[var(--text-strong)]"
                  />
                </td>
                <td class="py-1 text-center">
                  <button
                    onclick={() => deleteHeader(h.id)}
                    class="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--danger)] transition-opacity"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <button
          onclick={addHeader}
          class="mt-2.5 flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
        >
          <Plus size={13} />
          <span>Add Header</span>
        </button>
      </div>

    <!-- 3. BODY TAB -->
    {:else if activeTab === 'body'}
      <div class="flex-1 flex flex-col p-3 overflow-hidden">
        <!-- Body Type Radios -->
        <div class="flex flex-wrap items-center gap-3 mb-2 text-xs text-[var(--text)] select-none">
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              value="none"
              bind:group={model.bodyType}
              onchange={syncToWorkspace}
              class="accent-[var(--accent)]"
            />
            <span>None</span>
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              value="json"
              bind:group={model.bodyType}
              onchange={syncToWorkspace}
              class="accent-[var(--accent)]"
            />
            <span>JSON</span>
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              value="text"
              bind:group={model.bodyType}
              onchange={syncToWorkspace}
              class="accent-[var(--accent)]"
            />
            <span>Raw Text</span>
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              value="urlencoded"
              bind:group={model.bodyType}
              onchange={syncToWorkspace}
              class="accent-[var(--accent)]"
            />
            <span>x-www-form-urlencoded</span>
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              value="multipart"
              bind:group={model.bodyType}
              onchange={syncToWorkspace}
              class="accent-[var(--accent)]"
            />
            <span>form-data / multipart</span>
          </label>

          {#if model.bodyType === 'json'}
            <button
              onclick={beautifyJson}
              class="ml-auto ui-button ui-button-secondary h-6 px-2 text-[10px]"
            >
              Beautify JSON
            </button>
          {/if}
        </div>

        {#if model.bodyType === 'json' || model.bodyType === 'text'}
          <textarea
            bind:value={model.bodyRaw}
            oninput={syncToWorkspace}
            onmousemove={(e) => handleVarHover(e, model.bodyRaw)}
            onmouseleave={handleVarLeave}
            onscroll={handleVarLeave}
            onblur={handleVarLeave}
            placeholder={model.bodyType === 'json' ? '{\n  "key": "value"\n}' : 'Enter raw payload'}
            wrap="soft"
            spellcheck="false"
            class="flex-1 w-full whitespace-pre-wrap break-words bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded p-2.5 font-mono text-xs leading-relaxed text-[var(--text-strong)] outline-none resize-none transition-colors"
          ></textarea>
        {:else if model.bodyType === 'urlencoded' || model.bodyType === 'multipart'}
          <div class="flex-1 overflow-y-auto">
            <table class="w-full text-left font-mono text-xs">
              <thead>
                <tr class="text-[var(--text-subtle)] border-b border-[var(--border)]">
                  <th class="w-8 pb-1.5"></th>
                  <th class="pb-1.5 font-medium">Field</th>
                  <th class="pb-1.5 font-medium">{model.bodyType === 'multipart' ? 'Value / File' : 'Value'}</th>
                  <th class="w-8 pb-1.5"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--border-subtle)]">
                {#each model.bodyUrlencoded as item}
                  <tr class="hover:bg-[var(--surface-hover)] group transition-colors">
                    <td class="py-1 text-center">
                      <input
                        type="checkbox"
                        bind:checked={item.enabled}
                        onchange={syncToWorkspace}
                        class="rounded accent-[var(--accent)]"
                      />
                    </td>
                    <td class="py-1 pr-2">
                      <input
                        type="text"
                        placeholder="field"
                        bind:value={item.key}
                        oninput={syncToWorkspace}
                        onmousemove={(e) => handleVarHover(e, item.key)}
                        onmouseleave={handleVarLeave}
                        onblur={handleVarLeave}
                        class="w-full bg-transparent border-b border-transparent hover:border-[var(--border-strong)] focus:border-[var(--focus)] px-1 py-0.5 outline-none text-[var(--text-strong)]"
                      />
                      {#if model.bodyType === 'multipart'}
                        <label class="mt-1 inline-flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                          <input
                            type="checkbox"
                            bind:checked={item.isFile}
                            onchange={() => { if (item.isFile) void chooseFormFile(item.id); else { item.value = ''; syncToWorkspace(); } }}
                            class="rounded accent-[var(--accent)]"
                          />
                          File upload
                        </label>
                      {/if}
                    </td>
                    <td class="py-1 pr-2">
                      {#if model.bodyType === 'multipart' && item.isFile}
                        <div class="flex items-center gap-2">
                          <button
                            onclick={() => chooseFormFile(item.id)}
                            class="shrink-0 ui-button ui-button-secondary h-6 px-2 text-[10px]"
                          >
                            {item.value ? 'Choose another file' : 'Choose file…'}
                          </button>
                          <span class="truncate text-[11px] text-[var(--text-muted)]" title={item.value}>
                            {item.value || 'No file selected'}
                          </span>
                        </div>
                      {:else}
                        <input
                          type="text"
                          placeholder="value"
                          bind:value={item.value}
                          oninput={syncToWorkspace}
                          onmousemove={(e) => handleVarHover(e, item.value)}
                          onmouseleave={handleVarLeave}
                          onblur={handleVarLeave}
                          class="w-full bg-transparent border-b border-transparent hover:border-[var(--border-strong)] focus:border-[var(--focus)] px-1 py-0.5 outline-none text-[var(--text-strong)]"
                        />
                      {/if}
                    </td>
                    <td class="py-1 text-center">
                      <button
                        onclick={() => deleteFormParam(item.id)}
                        class="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--danger)] transition-opacity"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
            <button
              onclick={addFormParam}
              class="mt-2.5 flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
            >
              <Plus size={13} />
              <span>Add Form Field</span>
            </button>
          </div>
        {:else}
          <div class="m-auto text-[var(--text-subtle)] text-xs">
            This request does not have a body.
          </div>
        {/if}
      </div>

    <!-- 4. AUTH TAB -->
    {:else if activeTab === 'auth'}
      <div class="flex-1 p-4 overflow-y-auto max-w-lg space-y-4">
        <div>
          <label for="auth-type-select" class="block text-[var(--text-muted)] text-xs font-semibold mb-1">
            Type
          </label>
          <select
            id="auth-type-select"
            bind:value={model.authType}
            onchange={syncToWorkspace}
            class="ui-select px-2.5 py-1 text-xs"
          >
            <option value="none">No Auth</option>
            <option value="bearer">Bearer Token</option>
            <option value="basic">Basic Auth</option>
          </select>
        </div>

        {#if model.authType === 'bearer'}
          <div>
            <label for="bearer-token-input" class="block text-[var(--text-muted)] text-xs font-semibold mb-1">
              Token
            </label>
            <input
              id="bearer-token-input"
              type="text"
              placeholder={"e.g. {{auth_token}} or token_xyz"}
              bind:value={model.bearerToken}
              oninput={syncToWorkspace}
              onmousemove={(e) => handleVarHover(e, model.bearerToken)}
              onmouseleave={handleVarLeave}
              onblur={handleVarLeave}
              class="w-full bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-3 py-1.5 font-mono text-xs text-[var(--text-strong)] outline-none"
            />
          </div>
        {:else if model.authType === 'basic'}
          <div class="space-y-3">
            <div>
              <label for="basic-username-input" class="block text-[var(--text-muted)] text-xs font-semibold mb-1">
                Username
              </label>
              <input
                id="basic-username-input"
                type="text"
                placeholder="Username"
                bind:value={model.basicUser}
                oninput={syncToWorkspace}
                onmousemove={(e) => handleVarHover(e, model.basicUser)}
                onmouseleave={handleVarLeave}
                onblur={handleVarLeave}
                class="w-full bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-3 py-1.5 font-mono text-xs text-[var(--text-strong)] outline-none"
              />
            </div>
            <div>
              <label for="basic-password-input" class="block text-[var(--text-muted)] text-xs font-semibold mb-1">
                Password
              </label>
              <div class="relative">
                <input
                  id="basic-password-input"
                  type={showBasicPassword ? 'text' : 'password'}
                  placeholder="Password"
                  bind:value={model.basicPass}
                  oninput={syncToWorkspace}
                  onmousemove={(e) => handleVarHover(e, model.basicPass)}
                  onmouseleave={handleVarLeave}
                  onblur={handleVarLeave}
                  class="w-full bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-3 py-1.5 pr-9 font-mono text-xs text-[var(--text-strong)] outline-none"
                />
                <button
                  type="button"
                  onclick={() => (showBasicPassword = !showBasicPassword)}
                  aria-label={showBasicPassword ? 'Hide password' : 'Reveal password'}
                  title={showBasicPassword ? 'Hide password' : 'Reveal password'}
                  class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--text-muted)] hover:text-[var(--text-strong)]"
                >
                  {#if showBasicPassword}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
                </button>
              </div>
            </div>
          </div>
        {:else}
          <p class="text-[var(--text-muted)] text-xs">
            This request does not use any authorization headers.
          </p>
        {/if}
      </div>

    <!-- 5. SCRIPTS TAB (Postman-style Pre-request & Post-response) -->
    {:else if activeTab === 'scripts'}
      <div class="flex-1 flex flex-col overflow-hidden bg-[var(--surface)]">
        <!-- Sub-tab switcher -->
        <div class="px-3 py-1.5 bg-[var(--surface-muted)] border-b border-[var(--border)] flex items-center justify-between">
          <div class="flex items-center gap-1">
            <button
              onclick={() => (scriptSubTab = 'pre')}
              class="px-2.5 py-1 rounded text-xs font-medium transition-colors {scriptSubTab === 'pre'
                ? 'bg-[var(--surface)] text-[var(--text-strong)] shadow-sm font-semibold border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-strong)]'}"
            >
              Pre-request Script
              {#if preRequestScript.trim()}
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] inline-block ml-1"></span>
              {/if}
            </button>
            <button
              onclick={() => (scriptSubTab = 'post')}
              class="px-2.5 py-1 rounded text-xs font-medium transition-colors {scriptSubTab === 'post'
                ? 'bg-[var(--surface)] text-[var(--text-strong)] shadow-sm font-semibold border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-strong)]'}"
            >
              Post-response Script (Tests)
              {#if postResponseScript.trim()}
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] inline-block ml-1"></span>
              {/if}
            </button>
          </div>
          <span class="text-[10px] text-[var(--text-subtle)] font-mono">
            {scriptSubTab === 'pre' ? 'Runs before sending request' : 'Runs after response is received'}
          </span>
        </div>

        <!-- Editor & Snippets Split -->
        <div class="flex-1 flex overflow-hidden">
          <!-- Code Editor Area -->
          <div class="flex-1 flex flex-col p-3 overflow-hidden">
            {#if scriptSubTab === 'pre'}
              <textarea
                bind:value={preRequestScript}
                oninput={syncScriptsToWorkspace}
                placeholder={"// JavaScript to execute BEFORE sending the request\n// e.g. pm.environment.set(\"request_time\", Date.now());\n// Available: pm.environment, pm.variables, pm.request, console.log"}
                wrap="soft"
                spellcheck="false"
                class="flex-1 w-full whitespace-pre-wrap break-words bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded p-2.5 font-mono text-xs leading-relaxed text-[var(--text-strong)] outline-none resize-none transition-colors"
              ></textarea>
            {:else}
              <textarea
                bind:value={postResponseScript}
                oninput={syncScriptsToWorkspace}
                placeholder={"// JavaScript to execute AFTER response is received\n// e.g. pm.test(\"Status is 200\", function() {\n//   pm.response.to.have.status(200);\n// });\n// Available: pm.response, pm.environment, pm.test, pm.expect"}
                wrap="soft"
                spellcheck="false"
                class="flex-1 w-full whitespace-pre-wrap break-words bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded p-2.5 font-mono text-xs leading-relaxed text-[var(--text-strong)] outline-none resize-none transition-colors"
              ></textarea>
            {/if}
          </div>

          <!-- Postman-style Snippets Sidebar -->
          <div class="w-56 border-l border-[var(--border)] bg-[var(--surface-muted)] p-3 flex flex-col overflow-y-auto">
            <span class="font-semibold text-[var(--text-subtle)] uppercase tracking-wider text-[10px] mb-2">
              Snippets
            </span>
            <div class="space-y-0.5">
              {#if scriptSubTab === 'pre'}
                <button
                  type="button"
                  onclick={() => insertSnippet('pm.environment.set("variable_key", "variable_value");')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-[var(--accent)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  Set an environment variable
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('let val = pm.environment.get("variable_key");')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-[var(--accent)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  Get an environment variable
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('pm.request.headers.add({ key: "X-Trace-Id", value: crypto.randomUUID() });')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-[var(--accent)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  Add a request header
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('let uuid = crypto.randomUUID();\npm.environment.set("uuid", uuid);')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-[var(--accent)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  Generate dynamic UUID
                </button>
              {:else}
                <button
                  type="button"
                  onclick={() => insertSnippet('pm.test("Status code is 200", function () {\n  pm.response.to.have.status(200);\n});')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-[var(--accent)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  Status code: Code is 200
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('pm.test("Check JSON body property", function () {\n  let jsonData = pm.response.json();\n  pm.expect(jsonData).to.have.property("id");\n});')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-[var(--accent)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  Response body: JSON check
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('let jsonData = pm.response.json();\npm.environment.set("auth_token", jsonData.token);')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-[var(--accent)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  Set env var from JSON response
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('pm.test("Response time is less than 500ms", function () {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-[var(--accent)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  Response time &lt; 500ms
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('pm.test("Status text is OK", function () {\n  pm.response.to.have.status("OK");\n});')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-[var(--accent)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  Check status code name
                </button>
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Variable Hover Tooltip Card -->
  {#if varTooltip && varTooltip.visible}
    <div
      role="tooltip"
      onmouseenter={onTooltipMouseEnter}
      onmouseleave={onTooltipMouseLeave}
      class="ui-menu-surface fixed z-50 pointer-events-auto transition-all duration-100 ease-out p-2.5 text-xs w-72 backdrop-blur-sm {varTooltip.placement === 'top' ? '-translate-y-full -mt-2' : 'mt-2'}"
      style="left: {varTooltip.x}px; top: {varTooltip.y}px;"
    >
      <!-- Header: variable name & origin -->
      <div class="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[var(--border)]">
        <div class="flex items-center gap-1.5 truncate">
          <span class="font-mono font-bold text-[10px] px-1.5 py-0.2 rounded border {varTooltip.isDynamic
            ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
            : varTooltip.isSecret
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              : varTooltip.isDefined
                ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}">
            &#123;&#123;{varTooltip.variableName}&#125;&#125;
          </span>
        </div>
        <span class="text-[10px] font-medium text-[var(--text-muted)] shrink-0">
          {varTooltip.source}
        </span>
      </div>

      <!-- Resolved Value Section -->
      <div class="space-y-1">
        <div class="text-[10px] text-[var(--text-subtle)] uppercase tracking-wider font-semibold">
          Value:
        </div>
        <div class="font-mono text-[11px] p-1.5 rounded bg-[var(--surface)] border border-[var(--border)] break-all select-text max-h-24 overflow-y-auto">
          {#if varTooltip.isDefined}
            {#if varTooltip.isSecret}
              {@const isRevealed = isAltPressed || !!revealedTooltipSecrets[varTooltip.variableName]}
              <div class="flex items-center justify-between gap-1.5">
                <div class="flex-1 min-w-0">
                  {#if isRevealed}
                    <span class="text-[var(--warning)] font-semibold">{varTooltip.variableValue || '<empty>'}</span>
                  {:else}
                    <span class="text-[var(--text-muted)] font-mono tracking-widest select-none">••••••••••••</span>
                  {/if}
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <span class="text-[9px] text-[var(--warning)] bg-amber-500/10 px-1 py-0.5 rounded font-mono">secret</span>
                  <button
                    type="button"
                    onclick={() => {
                      if (varTooltip) {
                        revealedTooltipSecrets[varTooltip.variableName] = !revealedTooltipSecrets[varTooltip.variableName];
                      }
                    }}
                    title={isRevealed ? 'Hide secret' : `Reveal secret (or hold ${isMac ? '⌥' : 'Alt'})`}
                    aria-label={isRevealed ? 'Hide secret' : 'Reveal secret'}
                    class="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-strong)] transition-colors rounded hover:bg-[var(--surface-hover)]"
                  >
                    {#if isRevealed}
                      <EyeOff size={12} />
                    {:else}
                      <Eye size={12} />
                    {/if}
                  </button>
                </div>
              </div>
              <div class="text-[9px] text-[var(--text-subtle)] pt-0.5 flex items-center justify-between">
                <span>{isRevealed ? 'Revealed' : 'Hidden for security'}</span>
                <span class="font-mono text-[8px] opacity-75">{isMac ? 'Hold ⌥ to peek' : 'Hold Alt to peek'}</span>
              </div>
            {:else}
              <span class="text-[var(--success)] font-semibold">{varTooltip.variableValue || '<empty string>'}</span>
            {/if}
          {:else}
            <div class="text-[var(--danger)] italic flex items-center gap-1">
              <span>⚠️ Not found</span>
              <span class="text-[var(--text-muted)] font-sans text-[10px]">(click Variables in navbar)</span>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
