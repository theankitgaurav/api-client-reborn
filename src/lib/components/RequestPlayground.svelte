<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { envState } from '$lib/state/env.svelte';
  import { responseState } from '$lib/state/response.svelte';
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
    Plus,
    Trash2,
  } from '$lib/components/icons';

  let activeTab = $state<'params' | 'headers' | 'body' | 'auth' | 'scripts' | 'raw'>('params');
  let scriptSubTab = $state<'pre' | 'post'>('pre');
  let preRequestScript = $state('');
  let postResponseScript = $state('');

  let model = $state<PlaygroundModel>(parseCurlToPlayground(''));
  let rawEditMode = $state(false);

  let activeFilePath = $derived(workspaceState.activeFilePath);
  let isGrpcurl = $derived(activeFilePath?.endsWith('.grpcurl') ?? false);
  let commandLabel = $derived(isGrpcurl ? 'grpcurl' : 'cURL');

  // Whenever the active tab changes from workspace, load into model & scripts
  $effect(() => {
    const tab = workspaceState.activeTab;
    if (tab) {
      model = parseCurlToPlayground(tab.rawContent);
      if (tab.filePath?.endsWith('.grpcurl') || tab.method?.toUpperCase() === 'GRPC') {
        model.method = 'GRPC';
      }
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
      case 'GRPC':
        return 'text-cyan-500 font-bold';
      default:
        return 'text-neutral-400 font-bold';
    }
  }

  // --- Variable Hover Tooltip Logic ---
  interface VarTooltipData {
    visible: boolean;
    x: number;
    y: number;
    placement: 'top' | 'bottom';
    variableName: string;
    variableValue: string | null;
    isDefined: boolean;
    isSecret: boolean;
    isDynamic: boolean;
    source: string;
  }

  let varTooltip = $state<VarTooltipData | null>(null);

  function findVariablesInText(text: string) {
    if (!text) return [];
    const matches: { raw: string; name: string; start: number; end: number }[] = [];
    const regex = /\{\{([^}]+)\}\}/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
      matches.push({
        raw: m[0],
        name: m[1].trim(),
        start: m.index,
        end: m.index + m[0].length,
      });
    }
    return matches;
  }

  function getVariableInfo(token: string) {
    const key = token.trim();

    if (key === '$uuid') {
      return {
        variableName: '$uuid',
        variableValue: crypto.randomUUID(),
        isDefined: true,
        isSecret: false,
        isDynamic: true,
        source: 'Dynamic Generator',
      };
    }
    if (key === '$isoTimestamp') {
      return {
        variableName: '$isoTimestamp',
        variableValue: new Date().toISOString(),
        isDefined: true,
        isSecret: false,
        isDynamic: true,
        source: 'Dynamic Generator',
      };
    }
    if (key === '$timestamp') {
      return {
        variableName: '$timestamp',
        variableValue: Math.floor(Date.now() / 1000).toString(),
        isDefined: true,
        isSecret: false,
        isDynamic: true,
        source: 'Dynamic Generator',
      };
    }

    const found = envState.variables.find((v) => v.key.trim() === key);
    if (found) {
      return {
        variableName: key,
        variableValue: found.value,
        isDefined: true,
        isSecret: !!found.isSecret,
        isDynamic: false,
        source: found.isSecret ? 'Secret Variable' : 'Workspace Variable',
      };
    }

    if (envState.mergedVariables && key in envState.mergedVariables) {
      return {
        variableName: key,
        variableValue: envState.mergedVariables[key],
        isDefined: true,
        isSecret: false,
        isDynamic: false,
        source: 'Workspace Variable',
      };
    }

    return {
      variableName: key,
      variableValue: null,
      isDefined: false,
      isSecret: false,
      isDynamic: false,
      source: 'Unresolved Variable',
    };
  }

  function getVarTooltipTitle(text: string): string | undefined {
    if (!text || !text.includes('{{')) return undefined;
    const matches = findVariablesInText(text);
    if (matches.length === 0) return undefined;
    return matches
      .map((m) => {
        const info = getVariableInfo(m.name);
        return `{{${m.name}}}: ${info.variableValue ?? 'Unresolved'}`;
      })
      .join('\n');
  }

  function handleVarHover(e: MouseEvent, text: string) {
    if (!text || !text.includes('{{')) {
      varTooltip = null;
      return;
    }

    const matches = findVariablesInText(text);
    if (matches.length === 0) {
      varTooltip = null;
      return;
    }

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    let targetMatch = matches[0];

    if (matches.length > 1) {
      try {
        const style = window.getComputedStyle(target);
        const fontSize = parseFloat(style.fontSize) || 12;
        const charWidth = fontSize * 0.605;
        const paddingLeft = parseFloat(style.paddingLeft) || 8;

        if (target instanceof HTMLTextAreaElement) {
          const paddingTop = parseFloat(style.paddingTop) || 8;
          const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.5;
          const lineIdx = Math.max(0, Math.floor((e.clientY - rect.top - paddingTop + target.scrollTop) / lineHeight));
          const lines = text.split('\n');
          if (lineIdx < lines.length) {
            const lineText = lines[lineIdx];
            const lineMatches = findVariablesInText(lineText);
            if (lineMatches.length > 0) {
              const clickX = e.clientX - rect.left - paddingLeft + target.scrollLeft;
              const charIdx = Math.max(0, Math.floor(clickX / charWidth));
              targetMatch = lineMatches.find((m) => charIdx >= m.start && charIdx <= m.end) || lineMatches[0];
            }
          }
        } else {
          const scrollLeft = (target as HTMLInputElement).scrollLeft || 0;
          const clickX = e.clientX - rect.left - paddingLeft + scrollLeft;
          const charIdx = Math.max(0, Math.floor(clickX / charWidth));
          const found = matches.find((m) => charIdx >= m.start && charIdx <= m.end);
          if (found) {
            targetMatch = found;
          } else {
            let closest = matches[0];
            let minDiff = 9999;
            for (const match of matches) {
              const mid = (match.start + match.end) / 2;
              const diff = Math.abs(charIdx - mid);
              if (diff < minDiff) {
                minDiff = diff;
                closest = match;
              }
            }
            targetMatch = closest;
          }
        }
      } catch {
        targetMatch = matches[0];
      }
    }

    const info = getVariableInfo(targetMatch.name);
    const tooltipWidth = 280;
    let posX = Math.max(12, Math.min(e.clientX - 40, window.innerWidth - tooltipWidth - 16));
    let posY = rect.top - 8;
    let placement: 'top' | 'bottom' = 'top';

    if (posY < 90) {
      posY = rect.bottom + 8;
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
    varTooltip = null;
  }
</script>

<div class="flex-1 flex flex-col h-full bg-white dark:bg-[#1e1e1e] border-r border-[#e5e5e5] dark:border-[#2d2d2d] overflow-hidden text-xs">
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
    </div>

    <div class="flex items-center gap-2">
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
        <option value="GRPC" class="text-cyan-500 font-bold">GRPC</option>
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
        onmousemove={(e) => handleVarHover(e, model.url)}
        onmouseleave={handleVarLeave}
        title={getVarTooltipTitle(model.url)}
        placeholder={isGrpcurl || model.method === 'GRPC'
          ? "Enter host and endpoint (e.g. {{grpc_host}} api.v1.UserService/GetUser)"
          : "Enter request URL (e.g. {{base_url}}/users or https://api.example.com)"}
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
                    onmousemove={(e) => handleVarHover(e, param.key)}
                    onmouseleave={handleVarLeave}
                    title={getVarTooltipTitle(param.key)}
                    class="w-full bg-transparent border-b border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 focus:border-blue-500 px-1 py-0.5 outline-none text-neutral-800 dark:text-neutral-200"
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
                    title={getVarTooltipTitle(param.value)}
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
                    onmousemove={(e) => handleVarHover(e, h.key)}
                    onmouseleave={handleVarLeave}
                    title={getVarTooltipTitle(h.key)}
                    class="w-full bg-transparent border-b border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 focus:border-blue-500 px-1 py-0.5 outline-none text-neutral-800 dark:text-neutral-200"
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
                    title={getVarTooltipTitle(h.value)}
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
            onmousemove={(e) => handleVarHover(e, model.bodyRaw)}
            onmouseleave={handleVarLeave}
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
                        onmousemove={(e) => handleVarHover(e, item.key)}
                        onmouseleave={handleVarLeave}
                        title={getVarTooltipTitle(item.key)}
                        class="w-full bg-transparent border-b border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 focus:border-blue-500 px-1 py-0.5 outline-none text-neutral-800 dark:text-neutral-200"
                      />
                    </td>
                    <td class="py-1 pr-2">
                      <input
                        type="text"
                        placeholder="value"
                        bind:value={item.value}
                        oninput={syncToWorkspace}
                        onmousemove={(e) => handleVarHover(e, item.value)}
                        onmouseleave={handleVarLeave}
                        title={getVarTooltipTitle(item.value)}
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
              onmousemove={(e) => handleVarHover(e, model.bearerToken)}
              onmouseleave={handleVarLeave}
              title={getVarTooltipTitle(model.bearerToken)}
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
                onmousemove={(e) => handleVarHover(e, model.basicUser)}
                onmouseleave={handleVarLeave}
                title={getVarTooltipTitle(model.basicUser)}
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
                onmousemove={(e) => handleVarHover(e, model.basicPass)}
                onmouseleave={handleVarLeave}
                title={getVarTooltipTitle(model.basicPass)}
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
          onmousemove={(e) => handleVarHover(e, workspaceState.activeFile?.raw_content || '')}
          onmouseleave={handleVarLeave}
          spellcheck="false"
          class="flex-1 w-full bg-[#f9f9fb] dark:bg-[#121212] border border-[#d2d2d7] dark:border-[#2d2d2d] rounded p-3 font-mono text-[13px] leading-relaxed text-neutral-800 dark:text-neutral-200 outline-none resize-none focus:border-blue-500"
        ></textarea>
      </div>
    {/if}
  </div>


  <!-- Variable Hover Tooltip Card -->
  {#if varTooltip && varTooltip.visible}
    <div
      class="fixed z-50 pointer-events-none transition-all duration-100 ease-out bg-[#1e1e20] dark:bg-[#202022] text-neutral-100 border border-[#3e3e42] dark:border-[#38383c] shadow-2xl rounded-lg p-2.5 text-xs w-72 backdrop-blur-sm {varTooltip.placement === 'top' ? '-translate-y-full -mt-2' : 'mt-2'}"
      style="left: {varTooltip.x}px; top: {varTooltip.y}px;"
    >
      <!-- Header: variable name & origin -->
      <div class="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[#2e2e32] dark:border-[#2e2e32]">
        <div class="flex items-center gap-1.5 truncate">
          <span class="font-mono font-bold text-[10px] px-1.5 py-0.2 rounded border {varTooltip.isDynamic
            ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
            : varTooltip.isSecret
              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
              : varTooltip.isDefined
                ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                : 'bg-rose-500/20 text-rose-400 border-rose-500/30'}">
            &#123;&#123;{varTooltip.variableName}&#125;&#125;
          </span>
        </div>
        <span class="text-[10px] font-medium text-neutral-400 shrink-0">
          {varTooltip.source}
        </span>
      </div>

      <!-- Resolved Value Section -->
      <div class="space-y-1">
        <div class="text-[10px] text-neutral-400 uppercase tracking-wider font-semibold">
          Value:
        </div>
        <div class="font-mono text-[11px] p-1.5 rounded bg-[#141416] border border-[#2a2a2e] break-all select-text max-h-24 overflow-y-auto">
          {#if varTooltip.isDefined}
            {#if varTooltip.isSecret}
              <div class="flex items-center justify-between">
                <span class="text-emerald-400 font-semibold">{varTooltip.variableValue || '<empty>'}</span>
                <span class="text-[9px] text-amber-400 bg-amber-500/10 px-1 rounded ml-1">secret</span>
              </div>
            {:else}
              <span class="text-emerald-400 font-semibold">{varTooltip.variableValue || '<empty string>'}</span>
            {/if}
          {:else}
            <div class="text-rose-400 italic flex items-center gap-1">
              <span>⚠️ Not found</span>
              <span class="text-neutral-500 font-sans text-[10px]">(click Variables in navbar)</span>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
