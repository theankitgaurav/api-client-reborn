<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { envState } from '$lib/state/env.svelte';
  import { responseState } from '$lib/state/response.svelte';
  import { getResolvedCommand } from '$lib/utils/curl-generator';
  import TabBar from './TabBar.svelte';
  import {
    parseCurlToPlayground,
    serializePlaygroundToCurl,
    type PlaygroundModel,
  } from '$lib/utils/curl-serializer';
  import {
    Play,
    Square,
    Save,
    Terminal,
    Copy,
    Check,
    Plus,
    Trash2,
  } from '$lib/components/icons';

  let activeTab = $state<'params' | 'headers' | 'body' | 'auth' | 'scripts' | 'raw'>('params');
  let scriptSubTab = $state<'pre' | 'post'>('pre');
  let preRequestScript = $state('');
  let postResponseScript = $state('');

  let model = $state<PlaygroundModel>(parseCurlToPlayground(''));
  let showTerminalDrawer = $state(true);
  let copied = $state(false);
  let rawEditMode = $state(false);

  let activeFilePath = $derived(workspaceState.activeFilePath);
  let isGrpcurl = $derived(activeFilePath?.endsWith('.grpcurl') ?? false);
  let commandLabel = $derived(isGrpcurl ? 'grpcurl' : 'cURL');

  // Whenever the active tab changes from workspace, load into model & scripts
  $effect(() => {
    const tab = workspaceState.activeTab;
    if (tab) {
      model = parseCurlToPlayground(tab.rawContent);
      preRequestScript = tab.sidecar?.pre_request_script || '';
      postResponseScript = tab.sidecar?.post_response_script || '';
      rawEditMode = false;
    }
  });

  // Re-serialize back to workspace raw_content whenever model changes in playground mode
  function syncToWorkspace() {
    if (!rawEditMode && workspaceState.activeTab) {
      const serialized = serializePlaygroundToCurl(model);
      workspaceState.updateContent(serialized, model.method, model.name);
    }
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

  // Executable terminal command with evaluated variables
  let resolvedCommand = $derived(
    getResolvedCommand(
      workspaceState.activeFile?.raw_content || '',
      envState.mergedVariables
    )
  );

  function copyCommand() {
    navigator.clipboard.writeText(resolvedCommand);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 1800);
  }

  function handleSend() {
    if (responseState.isExecuting) {
      responseState.cancel();
    } else {
      responseState.runCurrentRequest();
    }
  }

  function getMethodColor(m: string) {
    switch (m.toUpperCase()) {
      case 'GET':
        return 'text-blue-500 font-bold';
      case 'POST':
        return 'text-emerald-500 font-bold';
      case 'PUT':
        return 'text-amber-500 font-bold';
      case 'DELETE':
        return 'text-rose-500 font-bold';
      case 'PATCH':
        return 'text-purple-500 font-bold';
      default:
        return 'text-neutral-400 font-bold';
    }
  }
</script>

<div class="flex-1 flex flex-col h-full bg-white dark:bg-[#1e1e1e] border-r border-[#e5e5e5] dark:border-[#2d2d2d] overflow-hidden text-xs">
  <!-- Multi-Tab Bar Strip -->
  <TabBar />

  <!-- Top Request Metadata & Toolbar -->
  <div class="px-3 py-2 bg-[#f9f9fb] dark:bg-[#252526] border-b border-[#e5e5e5] dark:border-[#2d2d2d] flex items-center justify-between">
    <div class="flex items-center gap-2 flex-1 mr-2">
      <input
        type="text"
        bind:value={model.name}
        oninput={syncToWorkspace}
        placeholder="Request Name"
        class="bg-transparent font-semibold text-neutral-800 dark:text-neutral-200 outline-none text-xs w-64 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 px-1.5 py-0.5 rounded transition-colors"
      />

      <!-- Streaming (-N) Flag Toggle -->
      <button
        type="button"
        onclick={() => {
          model.noBuffer = !model.noBuffer;
          syncToWorkspace();
        }}
        title="Toggle streaming / unbuffered response flag (-N)"
        class="px-2 py-0.5 rounded text-[11px] font-mono transition-colors {model.noBuffer
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-medium'
          : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 border border-dashed border-neutral-300 dark:border-neutral-700'}"
      >
        {model.noBuffer ? '⚡ Stream (-N)' : '+ Stream'}
      </button>
    </div>

    <div class="flex items-center gap-2">
      <!-- Quick Copy as cURL Button -->
      {#if workspaceState.activeFile}
        <button
          onclick={copyCommand}
          title="Copy executable {commandLabel} command with variables resolved (⌘⇧C)"
          class="flex items-center gap-1.5 text-xs bg-white dark:bg-[#2f2f30] hover:bg-neutral-100 dark:hover:bg-[#3a3a3c] text-neutral-700 dark:text-neutral-200 px-2.5 py-1 rounded border border-[#d2d2d7] dark:border-[#404040] transition-all shadow-sm active:scale-95"
        >
          {#if copied}
            <Check size={13} class="text-emerald-500" />
            <span class="text-emerald-600 dark:text-emerald-400 font-medium">Copied {commandLabel}!</span>
          {:else}
            <Terminal size={13} class="text-blue-500" />
            <span>Copy as {commandLabel}</span>
            <span class="text-[10px] text-neutral-400 font-mono">⌘⇧C</span>
          {/if}
        </button>
      {/if}

      <!-- Toggle Terminal Command Drawer -->
      <button
        onclick={() => (showTerminalDrawer = !showTerminalDrawer)}
        title="Toggle resolved {commandLabel} preview alongside playground"
        class="flex items-center gap-1 text-xs bg-white dark:bg-[#202020] hover:bg-neutral-100 dark:hover:bg-[#2a2a2a] text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 px-2 py-1 rounded border border-[#d2d2d7] dark:border-[#333] transition-colors"
      >
        <Terminal size={12} />
        <span>{showTerminalDrawer ? 'Hide CLI' : 'Show CLI'}</span>
      </button>

      {#if workspaceState.isDirty || !workspaceState.activeTab?.filePath}
        <button
          onclick={() => workspaceState.saveActiveFile()}
          class="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded transition-colors shadow-sm"
        >
          <Save size={12} />
          <span>Save (⌘S)</span>
        </button>
      {/if}
    </div>
  </div>

  <!-- Primary Postman Request Bar (Method + URL + Send) -->
  <div class="p-3 bg-white dark:bg-[#1e1e1e] border-b border-[#e5e5e5] dark:border-[#2d2d2d] flex items-center gap-2">
    <!-- Method Selector -->
    <div class="relative">
      <select
        bind:value={model.method}
        onchange={syncToWorkspace}
        class="bg-[#f0f0f2] dark:bg-[#2a2a2c] border border-[#d2d2d7] dark:border-[#3a3a3c] rounded px-2.5 py-1.5 font-mono text-xs cursor-pointer outline-none {getMethodColor(model.method)}"
      >
        <option value="GET" class="text-blue-500 font-bold">GET</option>
        <option value="POST" class="text-emerald-500 font-bold">POST</option>
        <option value="PUT" class="text-amber-500 font-bold">PUT</option>
        <option value="DELETE" class="text-rose-500 font-bold">DELETE</option>
        <option value="PATCH" class="text-purple-500 font-bold">PATCH</option>
        <option value="HEAD" class="text-neutral-400 font-bold">HEAD</option>
        <option value="OPTIONS" class="text-neutral-400 font-bold">OPTIONS</option>
      </select>
    </div>

    <!-- URL Bar -->
    <div class="flex-1 relative">
      <input
        type="text"
        value={model.url}
        oninput={(e) => handleUrlInput((e.target as HTMLInputElement).value)}
        placeholder={"Enter request URL (e.g. {{base_url}}/users or https://api.example.com)"}
        class="w-full bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-3 py-1.5 font-mono text-xs text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-blue-500 transition-colors"
      />
    </div>

    <!-- Send Button -->
    <button
      onclick={handleSend}
      class="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold text-white shadow-sm transition-all active:scale-95 {responseState.isExecuting
        ? 'bg-rose-600 hover:bg-rose-700'
        : 'bg-blue-600 hover:bg-blue-500'}"
    >
      {#if responseState.isExecuting}
        <Square size={13} fill="currentColor" />
        <span>Cancel</span>
      {:else}
        <Play size={13} fill="currentColor" />
        <span>Send</span>
        <span class="text-[10px] opacity-75 font-mono ml-0.5">⌘↵</span>
      {/if}
    </button>
  </div>

  <!-- Playground Tabs (Params | Headers | Body | Auth | Scripts | Raw) -->
  <div class="px-3 bg-white dark:bg-[#1e1e1e] border-b border-[#e5e5e5] dark:border-[#2d2d2d] flex items-center gap-1 select-none">
    <button
      onclick={() => (activeTab = 'params')}
      class="px-3 py-2 text-xs font-medium border-b-2 transition-colors {activeTab === 'params'
        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
        : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}"
    >
      Params {#if model.params.filter((p) => p.enabled && p.key).length > 0}
        <span class="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-blue-500/10 text-blue-500 font-mono">
          {model.params.filter((p) => p.enabled && p.key).length}
        </span>
      {/if}
    </button>

    <button
      onclick={() => (activeTab = 'headers')}
      class="px-3 py-2 text-xs font-medium border-b-2 transition-colors {activeTab === 'headers'
        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
        : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}"
    >
      Headers {#if model.headers.filter((h) => h.enabled && h.key).length > 0}
        <span class="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-blue-500/10 text-blue-500 font-mono">
          {model.headers.filter((h) => h.enabled && h.key).length}
        </span>
      {/if}
    </button>

    <button
      onclick={() => (activeTab = 'body')}
      class="px-3 py-2 text-xs font-medium border-b-2 transition-colors {activeTab === 'body'
        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
        : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}"
    >
      Body {#if model.bodyType !== 'none'}
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block ml-1"></span>
      {/if}
    </button>

    <button
      onclick={() => (activeTab = 'auth')}
      class="px-3 py-2 text-xs font-medium border-b-2 transition-colors {activeTab === 'auth'
        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
        : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}"
    >
      Auth {#if model.authType !== 'none'}
        <span class="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block ml-1"></span>
      {/if}
    </button>

    <button
      onclick={() => (activeTab = 'scripts')}
      class="px-3 py-2 text-xs font-medium border-b-2 transition-colors {activeTab === 'scripts'
        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
        : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}"
    >
      Scripts
      {#if preRequestScript.trim() || postResponseScript.trim()}
        <span class="w-1.5 h-1.5 rounded-full bg-purple-500 inline-block ml-1"></span>
      {/if}
    </button>

    <button
      onclick={() => (activeTab = 'raw')}
      class="px-3 py-2 text-xs font-medium border-b-2 transition-colors {activeTab === 'raw'
        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
        : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}"
    >
      Raw {commandLabel}
    </button>
  </div>

  <!-- Tab Content Body -->
  <div class="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#1a1a1a]">
    <!-- 1. PARAMS TAB -->
    {#if activeTab === 'params'}
      <div class="flex-1 overflow-y-auto p-3">
        <div class="text-[11px] font-semibold text-neutral-500 mb-2 uppercase tracking-wider">
          Query Parameters
        </div>
        <table class="w-full text-left font-mono text-xs">
          <thead>
            <tr class="text-neutral-400 border-b border-[#e5e5e5] dark:border-[#2d2d2d]">
              <th class="w-8 pb-1.5"></th>
              <th class="pb-1.5 font-medium">Key</th>
              <th class="pb-1.5 font-medium">Value</th>
              <th class="w-8 pb-1.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#efeff2] dark:divide-[#252525]">
            {#each model.params as param}
              <tr class="hover:bg-neutral-50 dark:hover:bg-[#202020] group">
                <td class="py-1 text-center">
                  <input
                    type="checkbox"
                    bind:checked={param.enabled}
                    onchange={syncToWorkspace}
                    class="rounded accent-blue-600"
                  />
                </td>
                <td class="py-1 pr-2">
                  <input
                    type="text"
                    placeholder="Key"
                    bind:value={param.key}
                    oninput={syncToWorkspace}
                    class="w-full bg-transparent border-b border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 focus:border-blue-500 px-1 py-0.5 outline-none text-neutral-800 dark:text-neutral-200"
                  />
                </td>
                <td class="py-1 pr-2">
                  <input
                    type="text"
                    placeholder={"Value (or {{variable}})"}
                    bind:value={param.value}
                    oninput={syncToWorkspace}
                    class="w-full bg-transparent border-b border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 focus:border-blue-500 px-1 py-0.5 outline-none text-neutral-800 dark:text-neutral-200"
                  />
                </td>
                <td class="py-1 text-center">
                  <button
                    onclick={() => deleteParam(param.id)}
                    class="opacity-0 group-hover:opacity-100 p-1 text-neutral-400 hover:text-rose-500 transition-opacity"
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
          class="mt-2.5 flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
        >
          <Plus size={13} />
          <span>Add Parameter</span>
        </button>
      </div>

    <!-- 2. HEADERS TAB -->
    {:else if activeTab === 'headers'}
      <div class="flex-1 overflow-y-auto p-3">
        <div class="text-[11px] font-semibold text-neutral-500 mb-2 uppercase tracking-wider">
          Request Headers
        </div>
        <table class="w-full text-left font-mono text-xs">
          <thead>
            <tr class="text-neutral-400 border-b border-[#e5e5e5] dark:border-[#2d2d2d]">
              <th class="w-8 pb-1.5"></th>
              <th class="pb-1.5 font-medium">Header Name</th>
              <th class="pb-1.5 font-medium">Header Value</th>
              <th class="w-8 pb-1.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#efeff2] dark:divide-[#252525]">
            {#each model.headers as h}
              <tr class="hover:bg-neutral-50 dark:hover:bg-[#202020] group">
                <td class="py-1 text-center">
                  <input
                    type="checkbox"
                    bind:checked={h.enabled}
                    onchange={syncToWorkspace}
                    class="rounded accent-blue-600"
                  />
                </td>
                <td class="py-1 pr-2">
                  <input
                    type="text"
                    placeholder="Header Name"
                    bind:value={h.key}
                    oninput={syncToWorkspace}
                    class="w-full bg-transparent border-b border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 focus:border-blue-500 px-1 py-0.5 outline-none text-neutral-800 dark:text-neutral-200"
                  />
                </td>
                <td class="py-1 pr-2">
                  <input
                    type="text"
                    placeholder="Header Value"
                    bind:value={h.value}
                    oninput={syncToWorkspace}
                    class="w-full bg-transparent border-b border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 focus:border-blue-500 px-1 py-0.5 outline-none text-neutral-800 dark:text-neutral-200"
                  />
                </td>
                <td class="py-1 text-center">
                  <button
                    onclick={() => deleteHeader(h.id)}
                    class="opacity-0 group-hover:opacity-100 p-1 text-neutral-400 hover:text-rose-500 transition-opacity"
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
          class="mt-2.5 flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
        >
          <Plus size={13} />
          <span>Add Header</span>
        </button>
      </div>

    <!-- 3. BODY TAB -->
    {:else if activeTab === 'body'}
      <div class="flex-1 flex flex-col p-3 overflow-hidden">
        <!-- Body Type Radios -->
        <div class="flex items-center gap-4 mb-2.5 text-xs text-neutral-700 dark:text-neutral-300 select-none">
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              value="none"
              bind:group={model.bodyType}
              onchange={syncToWorkspace}
              class="accent-blue-600"
            />
            <span>None</span>
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              value="json"
              bind:group={model.bodyType}
              onchange={syncToWorkspace}
              class="accent-blue-600"
            />
            <span>JSON</span>
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              value="text"
              bind:group={model.bodyType}
              onchange={syncToWorkspace}
              class="accent-blue-600"
            />
            <span>Raw Text</span>
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              value="urlencoded"
              bind:group={model.bodyType}
              onchange={syncToWorkspace}
              class="accent-blue-600"
            />
            <span>x-www-form-urlencoded</span>
          </label>

          {#if model.bodyType === 'json'}
            <button
              onclick={beautifyJson}
              class="ml-auto text-[11px] bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 px-2 py-0.5 rounded transition-colors text-neutral-700 dark:text-neutral-300"
            >
              Beautify JSON
            </button>
          {/if}
        </div>

        {#if model.bodyType === 'json' || model.bodyType === 'text'}
          <textarea
            bind:value={model.bodyRaw}
            oninput={syncToWorkspace}
            placeholder={model.bodyType === 'json' ? '{\n  "key": "value"\n}' : 'Enter raw payload'}
            spellcheck="false"
            class="flex-1 w-full bg-[#f9f9fb] dark:bg-[#121212] border border-[#d2d2d7] dark:border-[#2d2d2d] rounded p-3 font-mono text-[13px] leading-relaxed text-neutral-800 dark:text-neutral-200 outline-none resize-none focus:border-blue-500"
          ></textarea>
        {:else if model.bodyType === 'urlencoded'}
          <div class="flex-1 overflow-y-auto">
            <table class="w-full text-left font-mono text-xs">
              <thead>
                <tr class="text-neutral-400 border-b border-[#e5e5e5] dark:border-[#2d2d2d]">
                  <th class="w-8 pb-1.5"></th>
                  <th class="pb-1.5 font-medium">Field</th>
                  <th class="pb-1.5 font-medium">Value</th>
                  <th class="w-8 pb-1.5"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#efeff2] dark:divide-[#252525]">
                {#each model.bodyUrlencoded as item}
                  <tr class="hover:bg-neutral-50 dark:hover:bg-[#202020] group">
                    <td class="py-1 text-center">
                      <input
                        type="checkbox"
                        bind:checked={item.enabled}
                        onchange={syncToWorkspace}
                        class="rounded accent-blue-600"
                      />
                    </td>
                    <td class="py-1 pr-2">
                      <input
                        type="text"
                        placeholder="field"
                        bind:value={item.key}
                        oninput={syncToWorkspace}
                        class="w-full bg-transparent border-b border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 focus:border-blue-500 px-1 py-0.5 outline-none text-neutral-800 dark:text-neutral-200"
                      />
                    </td>
                    <td class="py-1 pr-2">
                      <input
                        type="text"
                        placeholder="value"
                        bind:value={item.value}
                        oninput={syncToWorkspace}
                        class="w-full bg-transparent border-b border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 focus:border-blue-500 px-1 py-0.5 outline-none text-neutral-800 dark:text-neutral-200"
                      />
                    </td>
                    <td class="py-1 text-center">
                      <button
                        onclick={() => deleteFormParam(item.id)}
                        class="opacity-0 group-hover:opacity-100 p-1 text-neutral-400 hover:text-rose-500 transition-opacity"
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
              class="mt-2.5 flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
            >
              <Plus size={13} />
              <span>Add Form Field</span>
            </button>
          </div>
        {:else}
          <div class="m-auto text-neutral-400 dark:text-neutral-600 text-xs">
            This request does not have a body.
          </div>
        {/if}
      </div>

    <!-- 4. AUTH TAB -->
    {:else if activeTab === 'auth'}
      <div class="flex-1 p-4 overflow-y-auto max-w-lg space-y-4">
        <div>
          <label for="auth-type-select" class="block text-neutral-600 dark:text-neutral-400 text-xs font-semibold mb-1">
            Type
          </label>
          <select
            id="auth-type-select"
            bind:value={model.authType}
            onchange={syncToWorkspace}
            class="bg-[#f0f0f2] dark:bg-[#252526] border border-[#d2d2d7] dark:border-[#383838] rounded px-2.5 py-1 text-xs text-neutral-800 dark:text-neutral-200 outline-none"
          >
            <option value="none">No Auth</option>
            <option value="bearer">Bearer Token</option>
            <option value="basic">Basic Auth</option>
          </select>
        </div>

        {#if model.authType === 'bearer'}
          <div>
            <label for="bearer-token-input" class="block text-neutral-600 dark:text-neutral-400 text-xs font-semibold mb-1">
              Token
            </label>
            <input
              id="bearer-token-input"
              type="text"
              placeholder={"e.g. {{auth_token}} or token_xyz"}
              bind:value={model.bearerToken}
              oninput={syncToWorkspace}
              class="w-full bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-3 py-1.5 font-mono text-xs text-neutral-800 dark:text-neutral-200 outline-none focus:border-blue-500"
            />
          </div>
        {:else if model.authType === 'basic'}
          <div class="space-y-3">
            <div>
              <label for="basic-username-input" class="block text-neutral-600 dark:text-neutral-400 text-xs font-semibold mb-1">
                Username
              </label>
              <input
                id="basic-username-input"
                type="text"
                placeholder="Username"
                bind:value={model.basicUser}
                oninput={syncToWorkspace}
                class="w-full bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-3 py-1.5 font-mono text-xs text-neutral-800 dark:text-neutral-200 outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label for="basic-password-input" class="block text-neutral-600 dark:text-neutral-400 text-xs font-semibold mb-1">
                Password
              </label>
              <input
                id="basic-password-input"
                type="password"
                placeholder="Password"
                bind:value={model.basicPass}
                oninput={syncToWorkspace}
                class="w-full bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-3 py-1.5 font-mono text-xs text-neutral-800 dark:text-neutral-200 outline-none focus:border-blue-500"
              />
            </div>
          </div>
        {:else}
          <p class="text-neutral-500 text-xs">
            This request does not use any authorization headers.
          </p>
        {/if}
      </div>

    <!-- 5. SCRIPTS TAB (Postman-style Pre-request & Post-response) -->
    {:else if activeTab === 'scripts'}
      <div class="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#1a1a1a]">
        <!-- Sub-tab switcher -->
        <div class="px-3 py-1.5 bg-[#f9f9fb] dark:bg-[#202020] border-b border-[#e5e5e5] dark:border-[#2d2d2d] flex items-center justify-between">
          <div class="flex items-center gap-2">
            <button
              onclick={() => (scriptSubTab = 'pre')}
              class="px-2.5 py-1 rounded text-xs font-medium transition-colors {scriptSubTab === 'pre'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-[#2d2d2d]'}"
            >
              Pre-request Script
              {#if preRequestScript.trim()}
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block ml-1"></span>
              {/if}
            </button>
            <button
              onclick={() => (scriptSubTab = 'post')}
              class="px-2.5 py-1 rounded text-xs font-medium transition-colors {scriptSubTab === 'post'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-[#2d2d2d]'}"
            >
              Post-response Script (Tests)
              {#if postResponseScript.trim()}
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block ml-1"></span>
              {/if}
            </button>
          </div>
          <span class="text-[10px] text-neutral-400 font-mono">
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
                spellcheck="false"
                class="flex-1 w-full bg-[#f9f9fb] dark:bg-[#121212] border border-[#d2d2d7] dark:border-[#2d2d2d] rounded p-3 font-mono text-[12px] leading-relaxed text-neutral-800 dark:text-neutral-200 outline-none resize-none focus:border-blue-500"
              ></textarea>
            {:else}
              <textarea
                bind:value={postResponseScript}
                oninput={syncScriptsToWorkspace}
                placeholder={"// JavaScript to execute AFTER response is received\n// e.g. pm.test(\"Status is 200\", function() {\n//   pm.response.to.have.status(200);\n// });\n// Available: pm.response, pm.environment, pm.test, pm.expect"}
                spellcheck="false"
                class="flex-1 w-full bg-[#f9f9fb] dark:bg-[#121212] border border-[#d2d2d7] dark:border-[#2d2d2d] rounded p-3 font-mono text-[12px] leading-relaxed text-neutral-800 dark:text-neutral-200 outline-none resize-none focus:border-blue-500"
              ></textarea>
            {/if}
          </div>

          <!-- Postman-style Snippets Sidebar -->
          <div class="w-56 border-l border-[#e5e5e5] dark:border-[#2d2d2d] bg-[#f9f9fb] dark:bg-[#181818] p-3 flex flex-col overflow-y-auto">
            <span class="font-semibold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider text-[10px] mb-2">
              Snippets
            </span>
            <div class="space-y-1">
              {#if scriptSubTab === 'pre'}
                <button
                  type="button"
                  onclick={() => insertSnippet('pm.environment.set("variable_key", "variable_value");')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-blue-600 dark:text-blue-400 hover:bg-neutral-200/60 dark:hover:bg-[#252526] transition-colors"
                >
                  Set an environment variable
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('let val = pm.environment.get("variable_key");')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-blue-600 dark:text-blue-400 hover:bg-neutral-200/60 dark:hover:bg-[#252526] transition-colors"
                >
                  Get an environment variable
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('pm.request.headers.add({ key: "X-Trace-Id", value: crypto.randomUUID() });')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-blue-600 dark:text-blue-400 hover:bg-neutral-200/60 dark:hover:bg-[#252526] transition-colors"
                >
                  Add a request header
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('let uuid = crypto.randomUUID();\npm.environment.set("uuid", uuid);')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-blue-600 dark:text-blue-400 hover:bg-neutral-200/60 dark:hover:bg-[#252526] transition-colors"
                >
                  Generate dynamic UUID
                </button>
              {:else}
                <button
                  type="button"
                  onclick={() => insertSnippet('pm.test("Status code is 200", function () {\n  pm.response.to.have.status(200);\n});')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-blue-600 dark:text-blue-400 hover:bg-neutral-200/60 dark:hover:bg-[#252526] transition-colors"
                >
                  Status code: Code is 200
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('pm.test("Check JSON body property", function () {\n  let jsonData = pm.response.json();\n  pm.expect(jsonData).to.have.property("id");\n});')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-blue-600 dark:text-blue-400 hover:bg-neutral-200/60 dark:hover:bg-[#252526] transition-colors"
                >
                  Response body: JSON check
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('let jsonData = pm.response.json();\npm.environment.set("auth_token", jsonData.token);')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-blue-600 dark:text-blue-400 hover:bg-neutral-200/60 dark:hover:bg-[#252526] transition-colors"
                >
                  Set env var from JSON response
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('pm.test("Response time is less than 500ms", function () {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-blue-600 dark:text-blue-400 hover:bg-neutral-200/60 dark:hover:bg-[#252526] transition-colors"
                >
                  Response time &lt; 500ms
                </button>
                <button
                  type="button"
                  onclick={() => insertSnippet('pm.test("Status text is OK", function () {\n  pm.response.to.have.status("OK");\n});')}
                  class="w-full text-left px-2 py-1 rounded text-[11px] text-blue-600 dark:text-blue-400 hover:bg-neutral-200/60 dark:hover:bg-[#252526] transition-colors"
                >
                  Check status code name
                </button>
              {/if}
            </div>
          </div>
        </div>
      </div>

    <!-- 6. RAW cURL TAB -->
    {:else if activeTab === 'raw'}
      <div class="flex-1 flex flex-col p-3 overflow-hidden">
        <textarea
          value={workspaceState.activeFile?.raw_content || ''}
          oninput={(e) => {
            rawEditMode = true;
            workspaceState.updateContent((e.target as HTMLTextAreaElement).value);
          }}
          spellcheck="false"
          class="flex-1 w-full bg-[#f9f9fb] dark:bg-[#121212] border border-[#d2d2d7] dark:border-[#2d2d2d] rounded p-3 font-mono text-[13px] leading-relaxed text-neutral-800 dark:text-neutral-200 outline-none resize-none focus:border-blue-500"
        ></textarea>
      </div>
    {/if}
  </div>

  <!-- Resolved Command Drawer (Always alongside the request) -->
  {#if workspaceState.activeFile && showTerminalDrawer}
    <div class="h-36 border-t border-[#e5e5e5] dark:border-[#2d2d2d] bg-[#f9f9fb] dark:bg-[#161616] flex flex-col overflow-hidden">
      <div class="px-3 py-1.5 bg-[#f0f0f3] dark:bg-[#1c1c1c] border-b border-[#e5e5e5] dark:border-[#282828] flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
        <div class="flex items-center gap-2">
          <Terminal size={12} class="text-emerald-500" />
          <span class="font-medium text-neutral-800 dark:text-neutral-300">Executable {commandLabel} (Variables Evaluated)</span>
          <span class="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono">Run directly in terminal</span>
        </div>
        <button
          onclick={copyCommand}
          class="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
        >
          {#if copied}
            <Check size={11} class="text-emerald-500" />
            <span class="text-emerald-600 dark:text-emerald-400">Copied</span>
          {:else}
            <Copy size={11} />
            <span>Copy</span>
          {/if}
        </button>
      </div>
      <pre class="flex-1 p-2.5 m-0 font-mono text-[12px] leading-relaxed overflow-auto text-emerald-700 dark:text-emerald-300/90 select-text bg-[#f5f5f7] dark:bg-[#121212]">{resolvedCommand || '// Type a command above'}</pre>
    </div>
  {/if}
</div>
