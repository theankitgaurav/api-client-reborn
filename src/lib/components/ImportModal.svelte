<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { envState } from '$lib/state/env.svelte';
  import { importCollectionBundle } from '$lib/ipc';
  import { parsePostmanCollection, type PostmanImportResult } from '$lib/utils/postman-importer';
  import { X, Upload, Check, AlertCircle, FileCode, Folder } from '$lib/components/icons';

  let rawInput = $state('');
  let fileName = $state('');
  let importType = $state<'file' | 'text'>('file');
  let parseResult = $state<PostmanImportResult | null>(null);
  let parseError = $state<string | null>(null);
  let isImporting = $state(false);
  let importSuccess = $state(false);

  function resetState() {
    rawInput = '';
    fileName = '';
    parseResult = null;
    parseError = null;
    isImporting = false;
    importSuccess = false;
  }

  function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    fileName = file.name;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      rawInput = content;
      processInput(content);
    };
    reader.readAsText(file);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;

    fileName = file.name;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      rawInput = content;
      processInput(content);
    };
    reader.readAsText(file);
  }

  function processInput(content: string) {
    parseError = null;
    parseResult = null;
    if (!content.trim()) return;

    try {
      if (content.trim().startsWith('{')) {
        // Try Postman collection JSON
        const result = parsePostmanCollection(content);
        if (result.items.length === 0) {
          parseError = 'No valid requests found in this collection JSON.';
          return;
        }
        parseResult = result;
      } else if (content.trim().startsWith('curl ') || content.trim().startsWith('grpcurl ') || content.trim().startsWith('#')) {
        // Raw cURL or grpcurl command input
        const isGrpc = content.trim().startsWith('grpcurl');
        const ext = isGrpc ? 'grpcurl' : 'curl';
        const defaultName = isGrpc ? 'Imported gRPC Request' : 'Imported cURL Request';

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
      } else {
        parseError = 'Unrecognized format. Please provide a Postman Collection JSON or cURL/grpcurl command.';
      }
    } catch (e) {
      parseError = `Failed to parse import content: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  async function executeImport() {
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
        parseResult.variables.length > 0 ? parseResult.variables : undefined
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
        return 'bg-neutral-800 text-neutral-400 border border-neutral-700';
    }
  }
</script>

{#if workspaceState.isImportModalOpen}
  <div class="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white dark:bg-[#202020] border border-neutral-200 dark:border-[#333] rounded-lg shadow-2xl w-full max-w-xl overflow-hidden flex flex-col text-xs max-h-[85vh]">
      <!-- Header -->
      <div class="px-4 py-3 bg-[#f9f9fb] dark:bg-[#252526] border-b border-neutral-200 dark:border-[#333] flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Upload size={16} class="text-blue-500" />
          <h2 class="font-semibold text-neutral-800 dark:text-neutral-200 text-sm">
            Import Collection or Requests
          </h2>
        </div>
        <button
          onclick={() => {
            workspaceState.isImportModalOpen = false;
            resetState();
          }}
          class="text-neutral-500 hover:text-neutral-800 dark:hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <!-- Mode Selector Tabs -->
      <div class="flex border-b border-neutral-200 dark:border-[#333] bg-neutral-100 dark:bg-[#1a1a1a] px-4 pt-2 gap-4">
        <button
          class="pb-2 text-xs font-medium border-b-2 transition-colors {importType === 'file'
            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
            : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300'}"
          onclick={() => (importType = 'file')}
        >
          Upload Collection File
        </button>
        <button
          class="pb-2 text-xs font-medium border-b-2 transition-colors {importType === 'text'
            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
            : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300'}"
          onclick={() => (importType = 'text')}
        >
          Paste Raw JSON or cURL
        </button>
      </div>

      <!-- Body -->
      <div class="p-4 space-y-4 overflow-y-auto flex-1 bg-white dark:bg-[#202020]">
        {#if importType === 'file'}
          <!-- Drag and Drop Dropzone -->
          <label
            ondragover={(e) => e.preventDefault()}
            ondrop={handleDrop}
            class="border-2 border-dashed border-neutral-300 dark:border-[#383838] hover:border-blue-500 dark:hover:border-blue-500 rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-neutral-50 dark:bg-[#181818]"
          >
            <Upload size={28} class="text-neutral-400 dark:text-neutral-500 mb-2" />
            <span class="font-medium text-neutral-700 dark:text-neutral-200">
              {fileName ? fileName : 'Choose a file or drag & drop it here'}
            </span>
            <span class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1">
              Supports Postman Collection v2.0 / v2.1 (.json) or .curl / .grpcurl files
            </span>
            <input
              type="file"
              accept=".json,.curl,.grpcurl"
              class="hidden"
              onchange={handleFileSelect}
            />
          </label>
        {:else}
          <!-- Text Input -->
          <div>
            <label for="raw-import-text" class="block text-neutral-600 dark:text-neutral-400 font-medium mb-1.5">
              Paste Postman Collection JSON, cURL command, or grpcurl command:
            </label>
            <textarea
              id="raw-import-text"
              rows={6}
              bind:value={rawInput}
              oninput={(e) => processInput((e.target as HTMLTextAreaElement).value)}
              placeholder="Paste JSON or cURL string here..."
              class="w-full bg-neutral-50 dark:bg-[#181818] border border-neutral-300 dark:border-[#333] rounded p-2.5 font-mono text-[11px] text-neutral-800 dark:text-neutral-200 outline-none focus:border-blue-500"
            ></textarea>
          </div>
        {/if}

        <!-- Error Message -->
        {#if parseError}
          <div class="flex items-start gap-2 p-2.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded text-rose-700 dark:text-rose-400 text-xs">
            <AlertCircle size={15} class="shrink-0 mt-0.5" />
            <span>{parseError}</span>
          </div>
        {/if}

        <!-- Import Summary Preview -->
        {#if parseResult}
          <div class="border border-neutral-200 dark:border-[#333] rounded-md overflow-hidden bg-neutral-50/50 dark:bg-[#181818]">
            <div class="px-3 py-2 bg-neutral-100 dark:bg-[#252526] border-b border-neutral-200 dark:border-[#333] flex items-center justify-between">
              <div class="font-medium text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
                <Folder size={13} class="text-blue-500" />
                <span>{parseResult.collectionName}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full text-[10px] font-mono">
                  {parseResult.totalRequests} {parseResult.totalRequests === 1 ? 'request' : 'requests'}
                </span>
                {#if parseResult.variables.length > 0}
                  <span class="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full text-[10px] font-mono" title="Saved to environments/{parseResult.collectionName}.env.json">
                    {parseResult.variables.length} vars
                  </span>
                {/if}
              </div>
            </div>

            <!-- Request List Preview (truncated to top 15) -->
            <div class="max-h-48 overflow-y-auto divide-y divide-neutral-200 dark:divide-[#2a2a2a] p-1">
              {#each parseResult.items.slice(0, 15) as item}
                <div class="px-2.5 py-1.5 flex items-center justify-between text-[11px]">
                  <div class="flex items-center gap-2 truncate mr-2">
                    <FileCode size={12} class="text-neutral-400 shrink-0" />
                    <span class="font-medium text-neutral-800 dark:text-neutral-200 truncate">
                      {item.name}
                    </span>
                    <span class="text-[10px] text-neutral-400 font-mono truncate">
                      {item.relativePath}
                    </span>
                  </div>
                  {#if item.sidecar?.post_response_script || item.sidecar?.pre_request_script}
                    <span class="text-[10px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.2 rounded font-mono shrink-0">
                      Scripts
                    </span>
                  {/if}
                </div>
              {/each}
              {#if parseResult.items.length > 15}
                <div class="px-3 py-1.5 text-center text-neutral-400 text-[10px]">
                  + {parseResult.items.length - 15} more requests
                </div>
              {/if}
            </div>
          </div>
        {/if}

        {#if importSuccess}
          <div class="flex items-center gap-2 p-2.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 rounded text-emerald-700 dark:text-emerald-400 text-xs font-medium">
            <Check size={16} />
            <span>Collection successfully imported into workspace!</span>
          </div>
        {/if}
      </div>

      <!-- Footer Actions -->
      <div class="px-4 py-3 bg-[#f9f9fb] dark:bg-[#252526] border-t border-neutral-200 dark:border-[#333] flex items-center justify-end gap-2">
        <button
          onclick={() => {
            workspaceState.isImportModalOpen = false;
            resetState();
          }}
          class="px-3 py-1.5 rounded border border-neutral-300 dark:border-[#383838] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-[#303030] transition-colors"
        >
          Cancel
        </button>
        <button
          disabled={!parseResult || isImporting || importSuccess}
          onclick={executeImport}
          class="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3.5 py-1.5 rounded font-medium transition-colors shadow-sm active:scale-95"
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
      </div>
    </div>
  </div>
{/if}
