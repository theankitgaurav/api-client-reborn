<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { envState } from '$lib/state/env.svelte';
  import { importCollectionBundle } from '$lib/ipc';
  import {
    parsePostmanCollection,
    parsePostmanEnvironment,
    type PostmanEnvironmentImport,
    type PostmanImportResult,
  } from '$lib/utils/postman-importer';
  import { parseGrpcurlCommand } from '$lib/utils/grpcurl-importer';
  import { serializeGrpcRequest } from '$lib/utils/grpc';
  import { prepareRequestCollectionImport, readRequestArchive } from '$lib/utils/request-archive';
  import { Upload, Check, AlertCircle, FileCode, Folder } from '$lib/components/icons';
  import Modal from '$lib/components/ui/Modal.svelte';
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';

  let rawInput = $state('');
  let fileName = $state('');
  let importType = $state<'file' | 'text'>('file');
  let parseResult = $state<PostmanImportResult | null>(null);
  let environmentImport = $state<PostmanEnvironmentImport | null>(null);
  let parseError = $state<string | null>(null);
  let isImporting = $state(false);
  let importSuccess = $state(false);

  const modeItems = [
    { id: 'file', label: 'Upload File' },
    { id: 'text', label: 'Paste Text' },
  ];

  function resetState() {
    rawInput = '';
    fileName = '';
    parseResult = null;
    environmentImport = null;
    parseError = null;
    isImporting = false;
    importSuccess = false;
  }

  function closeModal() {
    workspaceState.isImportModalOpen = false;
    resetState();
  }

  async function processFile(file: File) {
    fileName = file.name;
    parseError = null;
    parseResult = null;
    environmentImport = null;
    rawInput = '';
    if (file.name.toLowerCase().endsWith('.zip')) {
      try {
        const files = await readRequestArchive(await file.arrayBuffer());
        const collection = prepareRequestCollectionImport(
          files,
          file.name,
          workspaceState.tree.map((item) => item.name)
        );
        parseResult = {
          collectionName: collection.collectionName,
          items: collection.files.map((file) => ({
            relativePath: file.path,
            content: file.content,
            name: file.path.split('/').at(-1) || file.path,
          })),
          variables: [],
          totalRequests: collection.files.length,
          totalFolders: new Set(collection.files.map((file) => file.path.split('/').slice(1, -1).join('/')).filter(Boolean)).size,
        };
        environmentImport = null;
      } catch (error) {
        parseResult = null;
        parseError = `Failed to read ZIP archive: ${error instanceof Error ? error.message : String(error)}`;
      }
      return;
    }

    try {
      processInput(await file.text());
    } catch (error) {
      parseError = `Failed to read file: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    void processFile(file);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    void processFile(file);
  }

  function processInput(content: string) {
    parseError = null;
    parseResult = null;
    environmentImport = null;
    if (!content.trim()) return;

    try {
      if (content.trim().startsWith('{')) {
        const parsedJson = JSON.parse(content);
        if (Array.isArray(parsedJson.values) && !Array.isArray(parsedJson.item)) {
          const result = parsePostmanEnvironment(content);
          if (result.variables.length === 0 && result.secretVariables.length === 0) {
            parseError = 'This Postman environment has no enabled variables.';
            return;
          }
          environmentImport = result;
          return;
        }
        const result = parsePostmanCollection(content);
        if (result.items.length === 0) {
          parseError = 'No valid requests found in this collection JSON.';
          return;
        }
        parseResult = result;
      } else if (content.trim().startsWith('curl ') || content.trim().startsWith('#')) {
        // Raw cURL command input
        const ext = 'curl';
        const defaultName = 'Imported cURL Request';

        const lines = content.split('\n');
        let customName = defaultName;
        for (const line of lines) {
          if (line.startsWith('# @name ')) {
            customName = line.replace('# @name ', '').trim();
          }
        }

        const slug = customName.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
        parseResult = {
          collectionName: 'Imported Requests',
          items: [
            {
              relativePath: `imported/${slug}.${ext}`,
              content: content.trim(),
              name: customName,
            },
          ],
          variables: [],
          totalRequests: 1,
          totalFolders: 1,
        };
      } else if (/\bgrpcurl(?:\.exe)?\b/i.test(content)) {
        const imported = parseGrpcurlCommand(content);
        const slug = imported.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'grpc_request';
        parseResult = {
          collectionName: 'Imported Requests',
          items: [
            {
              relativePath: `imported/${slug}.grpcurl`,
              content: serializeGrpcRequest(imported.config),
              name: imported.name,
            },
          ],
          variables: [],
          totalRequests: 1,
          totalFolders: 1,
        };
      } else {
        parseError = 'Unrecognized format. Please provide a Postman Collection JSON, cURL command, or grpcurl command.';
      }
    } catch (e) {
      parseError = `Failed to parse import content: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  async function executeImport() {
    if (environmentImport) {
      isImporting = true;
      parseError = null;
      try {
        await envState.importEnvironment(
          environmentImport.name,
          environmentImport.variables,
          environmentImport.secretVariables
        );
        importSuccess = true;
        setTimeout(() => {
          workspaceState.isImportModalOpen = false;
          resetState();
        }, 1000);
      } catch (error) {
        parseError = `Environment import failed: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        isImporting = false;
      }
      return;
    }
    if (!parseResult || parseResult.items.length === 0) return;
    isImporting = true;
    parseError = null;

    try {
      const filesPayload = parseResult.items.map((i) => ({
        relative_path: i.relativePath,
        content: i.content,
        sidecar: i.sidecar,
      }));

      await importCollectionBundle(
        parseResult.collectionName,
        filesPayload,
        parseResult.variables.length > 0 ? parseResult.variables : undefined,
        parseResult.secretVariables?.length ? parseResult.secretVariables : undefined
      );

      importSuccess = true;
      await workspaceState.refreshTree();
      await envState.refresh();

      setTimeout(() => {
        workspaceState.isImportModalOpen = false;
        resetState();
      }, 1000);
    } catch (e) {
      console.error('Import error:', e);
      parseError = `Import failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      isImporting = false;
    }
  }

  function getBadgeClass(method?: string) {
    switch (method?.toUpperCase()) {
      case 'GET':
        return 'badge-get';
      case 'POST':
        return 'badge-post';
      case 'PUT':
        return 'badge-put';
      case 'DELETE':
        return 'badge-delete';
      case 'PATCH':
        return 'badge-patch';
      default:
        return 'ui-badge ui-badge-neutral';
    }
  }
</script>

<Modal
  isOpen={workspaceState.isImportModalOpen}
  title="Import"
  description="Collection, Environment or Requests"
  maxWidth="xl"
  onclose={closeModal}
>
  {#snippet icon()}
    <Upload size={15} />
  {/snippet}

  {#snippet children()}
    <!-- Mode Selector -->
    <div class="px-4 pt-3 pb-0">
      <SegmentedControl items={modeItems} bind:activeId={importType} size="sm" />
    </div>

    <!-- Body -->
    <div class="p-4 space-y-4 text-xs">
      {#if importType === 'file'}
        <!-- Drag and Drop Dropzone -->
        <label
          ondragover={(e) => e.preventDefault()}
          ondrop={handleDrop}
          class="border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)] rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-[var(--surface-muted)]"
        >
          <Upload size={28} class="text-[var(--text-subtle)] mb-2" />
          <span class="font-medium text-[var(--text-strong)]">
            {fileName ? fileName : 'Choose a file or drag & drop it here'}
          </span>
          <span class="text-[11px] text-[var(--text-subtle)] mt-1">
            Supports ZIP request archives, Postman files, cURL and grpcurl files
          </span>
          <input
            type="file"
            accept=".zip,.json,.curl,.grpcurl,.grpc"
            class="hidden"
            onchange={handleFileSelect}
          />
        </label>
      {:else}
        <!-- Text Input -->
        <div>
          <label for="raw-import-text" class="block text-[var(--text-muted)] font-medium mb-1.5">
            Paste Postman Collection or Environment JSON, cURL command, or grpcurl command:
          </label>
          <textarea
            id="raw-import-text"
            rows={6}
            bind:value={rawInput}
            oninput={(e) => processInput((e.target as HTMLTextAreaElement).value)}
            placeholder="Paste Postman collection/environment JSON, cURL, or grpcurl command here..."
            class="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded p-2.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors"
          ></textarea>
        </div>
      {/if}

      <!-- Error Message -->
      {#if parseError}
        <div class="flex items-start gap-2 p-2.5 bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_25%,transparent)] rounded text-[var(--danger)] text-xs">
          <AlertCircle size={15} class="shrink-0 mt-0.5" />
          <span>{parseError}</span>
        </div>
      {/if}

      <!-- Import Summary Preview -->
      {#if environmentImport}
        <div class="border border-[var(--border)] rounded-md overflow-hidden bg-[var(--surface)]">
          <div class="px-3 py-2 bg-[var(--surface-muted)] border-b border-[var(--border)] flex items-center justify-between">
            <div class="font-medium text-[var(--text-strong)] flex items-center gap-1.5">
              <Folder size={13} class="text-[var(--accent)]" />
              <span>{environmentImport.name}</span>
            </div>
            <span class="ui-badge ui-badge-amber">
              {environmentImport.variables.length + environmentImport.secretVariables.length} variables
            </span>
          </div>
          <div class="px-3 py-2 text-[11px] text-[var(--text-muted)]">
            This environment will be saved locally and selected for requests. Secret typed values are stored in the ignored local secrets folder.
          </div>
        </div>
      {:else if parseResult}
        <div class="border border-[var(--border)] rounded-md overflow-hidden bg-[var(--surface)]">
          <div class="px-3 py-2 bg-[var(--surface-muted)] border-b border-[var(--border)] flex items-center justify-between">
            <div class="font-medium text-[var(--text-strong)] flex items-center gap-1.5">
              <Folder size={13} class="text-[var(--accent)]" />
              <span>{parseResult.collectionName}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="ui-badge ui-badge-blue">
                {parseResult.totalRequests} {parseResult.totalRequests === 1 ? 'request' : 'requests'}
              </span>
              {#if parseResult.variables.length > 0}
                <span class="ui-badge ui-badge-amber" title="Collection variables override selected environment and workspace secrets">
                  {parseResult.variables.length + (parseResult.secretVariables?.length || 0)} vars
                </span>
              {/if}
            </div>
          </div>
          {#if fileName.toLowerCase().endsWith('.zip')}
            <div class="px-3 py-2 text-[11px] text-[var(--text-muted)] border-t border-[var(--border)]">
              ZIP requests will be imported into a new collection. Existing workspace files will not be replaced.
            </div>
          {/if}

          <!-- Request List Preview (truncated to top 15) -->
          <div class="max-h-48 overflow-y-auto divide-y divide-[var(--border-subtle)] p-1">
            {#each parseResult.items.slice(0, 15) as item}
              <div class="px-2.5 py-1.5 flex items-center justify-between text-[11px]">
                <div class="flex items-center gap-2 truncate mr-2">
                  <FileCode size={12} class="text-[var(--text-subtle)] shrink-0" />
                  <span class="font-medium text-[var(--text-strong)] truncate">
                    {item.name}
                  </span>
                  <span class="text-[10px] text-[var(--text-subtle)] font-mono truncate">
                    {item.relativePath}
                  </span>
                </div>
                {#if item.sidecar?.post_response_script || item.sidecar?.pre_request_script}
                  <span class="ui-badge ui-badge-green shrink-0">
                    Scripts
                  </span>
                {/if}
              </div>
            {/each}
            {#if parseResult.items.length > 15}
              <div class="px-3 py-1.5 text-center text-[var(--text-subtle)] text-[10px]">
                + {parseResult.items.length - 15} more requests
              </div>
            {/if}
          </div>
        </div>
      {/if}

      {#if importSuccess}
        <div class="flex items-center gap-2 p-2.5 bg-[color-mix(in_srgb,var(--success)_10%,transparent)] border border-[color-mix(in_srgb,var(--success)_25%,transparent)] rounded text-[var(--success)] text-xs font-medium">
          <Check size={16} />
          <span>{environmentImport ? 'Environment successfully imported and selected!' : 'Collection successfully imported into workspace!'}</span>
        </div>
      {/if}
    </div>
  {/snippet}

  {#snippet footer()}
    <button
      onclick={closeModal}
      class="ui-button ui-button-secondary px-3 py-1.5"
    >
      Cancel
    </button>
    <button
      disabled={(!parseResult && !environmentImport) || isImporting || importSuccess}
      onclick={executeImport}
      class="ui-button ui-button-primary px-3.5 py-1.5"
    >
      {#if isImporting}
        <span>Importing...</span>
      {:else if importSuccess}
        <Check size={13} />
        <span>Done</span>
      {:else}
        <Upload size={13} />
        <span>Import to Workspace</span>
      {/if}
    </button>
  {/snippet}
</Modal>
