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
  let selectedSection = $state<'message' | 'metadata' | 'connection'>('message');
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
      selectedSection = 'message';
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
      services = await discoverGrpcServices(config);
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
</script>

<div class="flex-1 flex flex-col h-full bg-white dark:bg-[#1e1e1e] border-r border-[#e5e5e5] dark:border-[#2d2d2d] overflow-hidden text-xs">
  <div class="px-3 py-2 bg-[#f9f9fb] dark:bg-[#252526] border-b border-[#e5e5e5] dark:border-[#2d2d2d] flex items-center justify-between">
    <input
      aria-label="Request name"
      bind:value={config.name}
      oninput={sync}
      placeholder="gRPC Request Name"
      class="bg-transparent font-semibold text-neutral-800 dark:text-neutral-200 outline-none text-xs w-64 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 px-1.5 py-0.5 rounded"
    />
    <div class="flex items-center gap-2">
      <button
        onclick={copyGrpcurl}
        title="Copy as grpcurl"
        class="flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 dark:border-[#3a3a3c] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-[#303030]"
      >
        {#if copied}<Check size={12} /><span>Copied</span>{:else}<Copy size={12} /><span>grpcurl</span>{/if}
      </button>
      {#if workspaceState.isDirty || !workspaceState.activeTab?.filePath}
        <button onclick={() => workspaceState.saveActiveFile()} class="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded shadow-sm">
          <Save size={12} /><span>Save</span>
        </button>
      {/if}
    </div>
  </div>

  <div class="p-3 bg-white dark:bg-[#1e1e1e] border-b border-[#e5e5e5] dark:border-[#2d2d2d] space-y-2">
    <div class="flex items-center gap-2">
      <span class="font-mono font-bold text-violet-600 dark:text-violet-400 px-2">gRPC</span>
      <input
        aria-label="gRPC endpoint"
        bind:value={config.endpoint}
        oninput={sync}
        placeholder="http://127.0.0.1:50051"
        class="flex-1 bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-3 py-1.5 font-mono text-xs outline-none focus:border-blue-500"
      />
      <button
        onclick={loadServices}
        disabled={isDiscovering || (!config.use_reflection && !config.proto_file)}
        title="Load services and methods"
        class="flex items-center gap-1 px-2 py-1.5 rounded border border-neutral-300 dark:border-[#3a3a3c] text-neutral-700 dark:text-neutral-300 disabled:opacity-40"
      >
        <RefreshCw size={12} class={isDiscovering ? 'animate-spin' : ''} />
        <span>{isDiscovering ? 'Loading' : 'Load'}</span>
      </button>
      <button
        onclick={handleSend}
        class="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold text-white shadow-sm {responseState.isExecuting ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-500'}"
      >
        {#if responseState.isExecuting}<Square size={13} fill="currentColor" /><span>Cancel</span>{:else}<Play size={13} fill="currentColor" /><span>Send</span>{/if}
      </button>
    </div>

    <div class="flex items-center gap-2">
      <select
        aria-label="gRPC service"
        value={config.service}
        onchange={(event) => chooseService((event.target as HTMLSelectElement).value)}
        class="flex-1 min-w-0 bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-2 py-1.5 font-mono text-xs outline-none"
      >
        <option value="">{serviceNames.length ? 'Select service' : 'Load services or enter service name'}</option>
        {#each serviceNames as service}<option value={service}>{service}</option>{/each}
      </select>
      {#if !serviceNames.length}
        <input aria-label="gRPC service name" bind:value={config.service} oninput={sync} placeholder="package.Service" class="flex-1 min-w-0 bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-2 py-1.5 font-mono text-xs outline-none" />
      {/if}
      <select
        aria-label="gRPC method"
        value={config.method}
        onchange={(event) => { config.method = (event.target as HTMLSelectElement).value; sync(); }}
        class="flex-1 min-w-0 bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-2 py-1.5 font-mono text-xs outline-none"
      >
        <option value="">{methods.length ? 'Select method' : 'Method name'}</option>
        {#each methods as method}<option value={method.name}>{method.name}{method.client_streaming || method.server_streaming ? ' (stream)' : ''}</option>{/each}
      </select>
      {#if !methods.length}
        <input aria-label="gRPC method name" bind:value={config.method} oninput={sync} placeholder="Method" class="flex-1 min-w-0 bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-2 py-1.5 font-mono text-xs outline-none" />
      {/if}
    </div>
    {#if selectedMethod}
      <p class="text-[10px] text-neutral-500 font-mono">{selectedMethod.input_type} → {selectedMethod.output_type}{#if selectedMethod.client_streaming} · client stream{/if}{#if selectedMethod.server_streaming} · server stream{/if}</p>
    {/if}
    {#if discoverError}<p class="text-[11px] text-rose-600 dark:text-rose-400">{discoverError}</p>{/if}
  </div>

  <div class="px-3 bg-white dark:bg-[#1e1e1e] border-b border-[#e5e5e5] dark:border-[#2d2d2d] flex gap-1">
    {#each [{ key: 'message', label: 'Message' }, { key: 'metadata', label: 'Metadata' }, { key: 'connection', label: 'Connection' }] as section}
      <button
        onclick={() => (selectedSection = section.key as typeof selectedSection)}
        class="px-3 py-2 border-b-2 {selectedSection === section.key ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-neutral-500'}"
      >{section.label}</button>
    {/each}
  </div>

  <div class="flex-1 min-h-0 overflow-y-auto p-3 bg-white dark:bg-[#1a1a1a]">
    {#if selectedSection === 'message'}
      <div class="h-full flex flex-col gap-2">
        <div class="flex justify-between text-[11px] text-neutral-500">
          <label for="grpc-request-json" class="font-semibold uppercase tracking-wider">Request JSON</label>
          {#if selectedMethod?.client_streaming}<span>Provide an array of messages for client streaming</span>{/if}
        </div>
        <textarea
          id="grpc-request-json"
          bind:value={config.request_json}
          oninput={sync}
          spellcheck="false"
          class="flex-1 min-h-48 resize-none bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded p-3 font-mono text-xs leading-relaxed outline-none focus:border-blue-500"
          placeholder={'{\n  "id": 1\n}'}
        ></textarea>
      </div>
    {:else if selectedSection === 'metadata'}
      <div class="space-y-2">
        <div class="flex justify-between items-center"><h3 class="font-semibold text-neutral-700 dark:text-neutral-300">Request metadata</h3><button onclick={addMetadata} class="flex items-center gap-1 px-2 py-1 rounded hover:bg-neutral-200 dark:hover:bg-[#303030]"><Plus size={12} /> Add</button></div>
        {#each config.metadata as entry, index}
          <div class="flex gap-2 items-center">
            <input aria-label="Metadata key" value={entry.key} oninput={(event) => updateMetadata(index, 'key', (event.target as HTMLInputElement).value)} placeholder="key" class="flex-1 bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-2 py-1.5 font-mono outline-none" />
            <input aria-label="Metadata value" value={entry.value} oninput={(event) => updateMetadata(index, 'value', (event.target as HTMLInputElement).value)} placeholder="value" class="flex-1 bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-2 py-1.5 font-mono outline-none" />
            <button aria-label="Remove metadata" onclick={() => removeMetadata(index)} class="p-1 text-neutral-400 hover:text-rose-500"><Trash2 size={13} /></button>
          </div>
        {/each}
        {#if !config.metadata.length}<p class="text-neutral-500 py-4 text-center">No metadata headers</p>{/if}
      </div>
    {:else}
      <div class="max-w-xl space-y-4">
        <div class="space-y-2">
          <label class="flex items-center gap-2 text-neutral-700 dark:text-neutral-300"><input type="checkbox" bind:checked={config.use_reflection} onchange={sync} class="accent-blue-600" />Use server reflection</label>
          <label class="block text-[11px] text-neutral-500" for="grpc-proto-file">Proto file path</label>
          <div class="flex gap-2">
            <input id="grpc-proto-file" value={config.proto_file || ''} oninput={(event) => { config.proto_file = (event.target as HTMLInputElement).value || null; sync(); }} placeholder="/path/to/service.proto (overrides reflection)" class="flex-1 min-w-0 bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-2 py-1.5 font-mono outline-none" />
            <button onclick={chooseProtoFile} class="px-2 py-1.5 rounded border border-neutral-300 dark:border-[#3a3a3c] hover:bg-neutral-100 dark:hover:bg-[#303030]">Browse</button>
          </div>
        </div>
        <div class="border-t border-neutral-200 dark:border-[#333] pt-3 space-y-2">
          <label class="flex items-center gap-2 text-neutral-700 dark:text-neutral-300"><input type="checkbox" checked={config.tls_enabled} onchange={(event) => setTlsEnabled((event.target as HTMLInputElement).checked)} class="accent-blue-600" />Use TLS</label>
          {#if config.tls_enabled}
            <label class="flex items-center gap-2 text-amber-700 dark:text-amber-400"><input type="checkbox" bind:checked={config.tls_insecure} onchange={sync} class="accent-amber-600" />Skip server certificate validation</label>
            <label class="block text-[11px] text-neutral-500" for="grpc-ca-file">Custom CA certificate path (optional)</label>
            <input id="grpc-ca-file" bind:value={config.tls_ca_file} oninput={sync} placeholder="/path/to/ca.pem" class="w-full bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-2 py-1.5 font-mono outline-none" />
          {/if}
        </div>
        <div class="border-t border-neutral-200 dark:border-[#333] pt-3">
          <label class="block text-[11px] text-neutral-500 mb-1" for="grpc-timeout">Timeout (ms)</label>
          <input id="grpc-timeout" type="number" min="1" max="3600000" bind:value={config.timeout_ms} oninput={sync} class="w-40 bg-[#f9f9fb] dark:bg-[#181818] border border-[#d2d2d7] dark:border-[#333] rounded px-2 py-1.5 font-mono outline-none" />
        </div>
      </div>
    {/if}
  </div>
</div>
