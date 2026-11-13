<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { envState } from '$lib/state/env.svelte';
  import { responseState } from '$lib/state/response.svelte';
  import { discoverGrpcServices } from '$lib/ipc';
  import type { GrpcRequestConfig, GrpcServiceInfo } from '$lib/types';
  import { createDefaultGrpcRequest, parseGrpcRequest, resolveGrpcVariables, serializeGrpcRequest, toGrpcurl } from '$lib/utils/grpc';
  import { Play, Square, Save, Copy, Check, RefreshCw, Plus, Trash2 } from '$lib/components/icons';

  let config = $state<GrpcRequestConfig>(createDefaultGrpcRequest());
  let services = $state<GrpcServiceInfo[]>([]);
  let isDiscovering = $state(false);
  let discoverError = $state('');
  let selectedSection = $state<'message' | 'metadata' | 'connection'>('connection');
  let copied = $state(false);

  let serviceNames = $derived(services.map((service) => service.name));
  let methods = $derived(services.find((service) => service.name === config.service)?.methods || []);
  let selectedMethod = $derived(methods.find((method) => method.name === config.method) || null);

  $effect(() => {
    const tab = workspaceState.activeTab;
    if (tab?.requestType === 'grpc') {
      config = parseGrpcRequest(tab.rawContent);
      services = [];
      discoverError = '';
      selectedSection = 'connection';
    }
  });

  function sync() {
    config.name = config.name || 'New gRPC Request';
    workspaceState.updateContent(serializeGrpcRequest(config), 'gRPC', config.name);
  }

  async function loadServices() {
    isDiscovering = true;
    discoverError = '';
    try {
      services = await discoverGrpcServices(config, workspaceState.workspacePath);
      if (!services.some((service) => service.name === config.service)) {
        config.service = '';
        config.method = '';
      }
      sync();
    } catch (error) {
      discoverError = error instanceof Error ? error.message : String(error);
    } finally {
      isDiscovering = false;
    }
  }

  function chooseService(name: string) {
    config.service = name;
    config.method = services.find((service) => service.name === name)?.methods[0]?.name || '';
    updateRequestShapeForMethod(config.method);
    sync();
  }

  function updateRequestShapeForMethod(methodName: string) {
    const method = methods.find((item) => item.name === methodName);
    if (!method) return;

    try {
      const request = JSON.parse(config.request_json || '{}');
      if (method.client_streaming && !Array.isArray(request)) {
        config.request_json = JSON.stringify([request], null, 2);
      } else if (!method.client_streaming && Array.isArray(request) && request.length === 1) {
        config.request_json = JSON.stringify(request[0], null, 2);
      }
    } catch {
      // Keep invalid JSON editable so the user can correct it.
    }
  }

  function chooseMethod(name: string) {
    config.method = name;
    updateRequestShapeForMethod(name);
    sync();
  }

  async function chooseProtoFile() {
    try {
      let path: string | null = null;
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selection = await open({ multiple: false, filters: [{ name: 'Protocol Buffers', extensions: ['proto'] }] });
        path = typeof selection === 'string' ? selection : null;
      } else {
        path = window.prompt('Enter the path to a .proto file:', config.proto_file || '');
      }
      if (path) {
        config.proto_file = path;
        sync();
      }
    } catch (error) {
      discoverError = error instanceof Error ? error.message : String(error);
    }
  }

  function setTlsEnabled(enabled: boolean) {
    config.tls_enabled = enabled;
    if (config.endpoint.startsWith('http://')) {
      config.endpoint = `${enabled ? 'https' : 'http'}://${config.endpoint.slice('http://'.length)}`;
    } else if (config.endpoint.startsWith('https://')) {
      config.endpoint = `${enabled ? 'https' : 'http'}://${config.endpoint.slice('https://'.length)}`;
    }
    sync();
  }

  function addMetadata() {
    config.metadata = [...config.metadata, { key: '', value: '' }];
    sync();
  }

  function updateMetadata(index: number, key: 'key' | 'value', value: string) {
    config.metadata[index][key] = value;
    sync();
  }

  function removeMetadata(index: number) {
    config.metadata = config.metadata.filter((_, current) => current !== index);
    sync();
  }

  async function copyGrpcurl() {
    const command = toGrpcurl(resolveGrpcVariables(config, envState.mergedVariables));
    await navigator.clipboard.writeText(command);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  async function handleSend() {
    if (responseState.isExecuting) await responseState.cancel();
    else await responseState.runCurrentRequest();
  }

  function handleRequestTypeSelection(event: Event) {
    const method = (event.target as HTMLSelectElement).value;
    if (method !== 'gRPC') {
      workspaceState.switchRequestType('http', method);
    }
  }
</script>

<div class="contents text-xs">
  <div class="col-span-3 row-start-1 flex min-w-0 flex-col overflow-hidden">
    <div class="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5">
      <input
        aria-label="Request name"
        bind:value={config.name}
        oninput={sync}
        placeholder="gRPC Request Name"
        class="bg-transparent font-semibold text-[var(--text-strong)] outline-none text-xs w-64 hover:bg-[var(--surface-hover)] focus:bg-[var(--surface)] border border-transparent focus:border-[var(--border)] px-2 py-0.5 rounded transition-colors"
      />
      <div class="flex items-center gap-1.5">
        <button
          onclick={copyGrpcurl}
          title="Copy as grpcurl"
          class="ui-button ui-button-secondary h-6.5 px-2.5 text-[11px]"
        >
          {#if copied}<Check size={11} class="text-[var(--success)]" /><span>Copied</span>{:else}<Copy size={11} /><span>grpcurl</span>{/if}
        </button>
        {#if workspaceState.isDirty || !workspaceState.activeTab?.filePath}
          <button onclick={() => workspaceState.saveActiveFile()} class="ui-button ui-button-primary h-6.5 px-2.5 text-[11px]">
            <Save size={11} /><span>Save</span>
          </button>
        {/if}
      </div>
    </div>

    <div class="border-b border-[var(--border)] bg-[var(--surface)] p-2.5">
      <div class="flex items-center gap-2">
        <select
          aria-label="Request type"
          value="gRPC"
          onchange={handleRequestTypeSelection}
          class="ui-select h-8 px-2.5 font-mono text-xs cursor-pointer text-cyan-500 font-bold"
        >
          <option value="GET" class="text-blue-500 font-bold">GET</option>
          <option value="POST" class="text-emerald-500 font-bold">POST</option>
          <option value="PUT" class="text-amber-500 font-bold">PUT</option>
          <option value="DELETE" class="text-rose-500 font-bold">DELETE</option>
          <option value="PATCH" class="text-purple-500 font-bold">PATCH</option>
          <option value="HEAD" class="text-[var(--text-muted)] font-bold">HEAD</option>
          <option value="OPTIONS" class="text-[var(--text-muted)] font-bold">OPTIONS</option>
          <option value="gRPC" class="text-cyan-500 font-bold">gRPC</option>
        </select>
        <input
          aria-label="gRPC endpoint"
          bind:value={config.endpoint}
          oninput={sync}
          placeholder="http://127.0.0.1:50051"
          class="h-8 flex-1 bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-3 font-mono text-xs text-[var(--text-strong)] placeholder:text-[var(--text-subtle)] outline-none transition-colors"
        />
        <button
          onclick={loadServices}
          disabled={isDiscovering || (!config.use_reflection && !config.proto_file)}
          title="Discover services and methods"
          class="ui-button ui-button-secondary h-8 px-3 text-xs text-[var(--text)] disabled:opacity-40"
        >
          <RefreshCw size={11} class={isDiscovering ? 'animate-spin' : ''} />
          <span>{isDiscovering ? 'Discovering' : 'Discover'}</span>
        </button>
        <button
          onclick={handleSend}
          class="ui-button h-8 px-4 text-xs font-semibold text-white shadow-sm transition-all active:scale-[0.98] {responseState.isExecuting ? 'bg-[var(--danger)] hover:bg-[var(--danger-hover)]' : 'bg-[var(--accent)] hover:bg-[var(--accent-strong)]'}"
        >
          {#if responseState.isExecuting}<Square size={12} fill="currentColor" /><span>Cancel</span>{:else}<Play size={12} fill="currentColor" /><span>Send</span>{/if}
        </button>
      </div>
    </div>
  </div>

  <div class="col-start-1 row-start-2 flex gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-3 text-xs">
    {#each [{ key: 'connection', label: 'Connection' }, { key: 'message', label: 'Message' }, { key: 'metadata', label: 'Metadata' }] as section}
      <button
        onclick={() => (selectedSection = section.key as typeof selectedSection)}
        class="px-2.5 py-2 font-medium border-b-2 transition-colors {selectedSection === section.key ? 'border-[var(--accent)] text-[var(--text-strong)] font-semibold' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]'}"
      >{section.label}</button>
    {/each}
  </div>

  <div class="col-start-1 row-start-3 flex min-h-0 flex-col overflow-hidden bg-[var(--surface)] p-3">
    {#if selectedSection === 'message'}
      <div class="h-full flex flex-col gap-2">
        <div class="flex justify-between text-[10px] text-[var(--text-subtle)]">
          <label for="grpc-request-json" class="font-semibold uppercase tracking-wider">Request JSON</label>
          {#if selectedMethod?.client_streaming}<span>Provide an array of messages for client streaming</span>{/if}
        </div>
        <textarea
          id="grpc-request-json"
          bind:value={config.request_json}
          oninput={sync}
          wrap="soft"
          spellcheck="false"
          class="flex-1 min-h-48 resize-none whitespace-pre-wrap break-words bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded p-2.5 font-mono text-xs leading-relaxed text-[var(--text-strong)] outline-none transition-colors"
          placeholder={'{\n  "id": 1\n}'}
        ></textarea>
      </div>
    {:else if selectedSection === 'metadata'}
      <div class="w-full">
        <div class="mb-2 flex items-center justify-between">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">Request Metadata</div>
          <button onclick={addMetadata} class="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline">
            <Plus size={13} />
            <span>Add Metadata</span>
          </button>
        </div>
        <table class="w-full text-left font-mono text-xs">
          <thead>
            <tr class="border-b border-[var(--border)] text-[var(--text-subtle)]">
              <th class="pb-1.5 font-medium">Key</th>
              <th class="pb-1.5 font-medium">Value</th>
              <th class="w-8 pb-1.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-subtle)]">
            {#each config.metadata as entry, index}
              <tr class="group hover:bg-[var(--surface-hover)] transition-colors">
                <td class="py-1 pr-2">
                  <input aria-label="Metadata key" value={entry.key} oninput={(event) => updateMetadata(index, 'key', (event.target as HTMLInputElement).value)} placeholder="Key" class="w-full bg-transparent border-b border-transparent hover:border-[var(--border-strong)] focus:border-[var(--focus)] px-1 py-0.5 outline-none text-[var(--text-strong)]" />
                </td>
                <td class="py-1 pr-2">
                  <input aria-label="Metadata value" value={entry.value} oninput={(event) => updateMetadata(index, 'value', (event.target as HTMLInputElement).value)} placeholder="Value" class="w-full bg-transparent border-b border-transparent hover:border-[var(--border-strong)] focus:border-[var(--focus)] px-1 py-0.5 outline-none text-[var(--text-strong)]" />
                </td>
                <td class="py-1 text-center">
                  <button aria-label="Remove metadata" onclick={() => removeMetadata(index)} class="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--danger)] transition-opacity"><Trash2 size={13} /></button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !config.metadata.length}
          <div class="py-8 text-center text-[var(--text-subtle)]">No request metadata</div>
        {/if}
      </div>
    {:else}
      <div class="w-full space-y-4">
        <div class="grid grid-cols-2 gap-2">
          <div class="min-w-0 space-y-1">
            <label for="grpc-service-control" class="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Service</label>
            {#if serviceNames.length}
              <select
                id="grpc-service-control"
                value={config.service}
                onchange={(event) => chooseService((event.target as HTMLSelectElement).value)}
                class="ui-select ui-select-control w-full min-w-0 px-2 py-1.5 font-mono text-xs"
              >
                <option value="">Select a service</option>
                {#each serviceNames as service}<option value={service}>{service}</option>{/each}
              </select>
            {:else}
              <input
                id="grpc-service-control"
                bind:value={config.service}
                oninput={sync}
                placeholder="package.Service"
                class="w-full min-w-0 bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2.5 py-1.5 font-mono text-xs text-[var(--text-strong)] outline-none"
              />
            {/if}
          </div>
          <div class="min-w-0 space-y-1">
            <label for="grpc-method-control" class="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Method</label>
            {#if methods.length}
              <select
                id="grpc-method-control"
                value={config.method}
                onchange={(event) => chooseMethod((event.target as HTMLSelectElement).value)}
                class="ui-select ui-select-control w-full min-w-0 px-2 py-1.5 font-mono text-xs"
              >
                <option value="">Select a method</option>
                {#each methods as method}<option value={method.name}>{method.name}{method.client_streaming || method.server_streaming ? ' (stream)' : ''}</option>{/each}
              </select>
            {:else}
              <input
                id="grpc-method-control"
                bind:value={config.method}
                oninput={sync}
                placeholder="Method name"
                class="w-full min-w-0 bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2.5 py-1.5 font-mono text-xs text-[var(--text-strong)] outline-none"
              />
            {/if}
          </div>
        </div>
        {#if !serviceNames.length}<p class="text-[10px] text-[var(--text-subtle)]">Enter service and method names, or discover available options from the server.</p>{/if}
        {#if selectedMethod}
          <p class="text-[10px] text-[var(--text-muted)] font-mono">{selectedMethod.input_type} → {selectedMethod.output_type}{#if selectedMethod.client_streaming} · client stream{/if}{#if selectedMethod.server_streaming} · server stream{/if}</p>
        {/if}
        {#if discoverError}<p class="text-[11px] text-[var(--danger)]">{discoverError}</p>{/if}

        <div class="max-w-xl space-y-4">
          <div class="space-y-2">
            <label class="flex items-center gap-2 text-[var(--text-strong)]"><input type="checkbox" bind:checked={config.use_reflection} onchange={sync} class="accent-[var(--accent)]" />Use server reflection</label>
            <label class="block text-[11px] text-[var(--text-muted)]" for="grpc-proto-file">Proto file path</label>
            <div class="flex gap-2">
              <input id="grpc-proto-file" value={config.proto_file || ''} oninput={(event) => { config.proto_file = (event.target as HTMLInputElement).value || null; sync(); }} placeholder="/path/to/service.proto (overrides reflection)" class="flex-1 min-w-0 bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2.5 py-1.5 font-mono text-xs text-[var(--text-strong)] outline-none" />
              <button onclick={chooseProtoFile} class="ui-button ui-button-secondary h-7 px-3 text-xs">Browse</button>
            </div>
          </div>
          <div class="border-t border-[var(--border)] pt-3 space-y-2">
            <label class="flex items-center gap-2 text-[var(--text-strong)]"><input type="checkbox" checked={config.tls_enabled} onchange={(event) => setTlsEnabled((event.target as HTMLInputElement).checked)} class="accent-[var(--accent)]" />Use TLS</label>
            {#if config.tls_enabled}
              <label class="flex items-center gap-2 text-[var(--warning)]"><input type="checkbox" bind:checked={config.tls_insecure} onchange={sync} class="accent-[var(--warning)]" />Skip server certificate validation</label>
              <label class="block text-[11px] text-[var(--text-muted)]" for="grpc-ca-file">Custom CA certificate path (optional)</label>
              <input id="grpc-ca-file" bind:value={config.tls_ca_file} oninput={sync} placeholder="/path/to/ca.pem" class="w-full bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2.5 py-1.5 font-mono text-xs text-[var(--text-strong)] outline-none" />
            {/if}
          </div>
          <div class="border-t border-[var(--border)] pt-3">
            <label class="block text-[11px] text-[var(--text-muted)] mb-1" for="grpc-timeout">Timeout (ms)</label>
            <input id="grpc-timeout" type="number" min="1" max="3600000" bind:value={config.timeout_ms} oninput={sync} class="w-40 bg-[var(--surface-muted)] focus:bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--focus)] rounded px-2.5 py-1.5 font-mono text-xs text-[var(--text-strong)] outline-none" />
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
