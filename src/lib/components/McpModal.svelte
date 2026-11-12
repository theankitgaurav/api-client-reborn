<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { getMcpConfigInfo, type McpConfigInfo } from '$lib/ipc';
  import { X, Copy, Check, Bot } from '$lib/components/icons';

  let activeClient = $state<'cursor' | 'claude' | 'antigravity' | 'generic'>('cursor');
  let copied = $state(false);
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  let configInfo = $state<McpConfigInfo>({
    workspace_path: workspaceState.workspacePath || '~/.api-client-reborn',
    executable_path: 'api_client_reborn',
  });

  $effect(() => {
    if (workspaceState.isMcpModalOpen) {
      getMcpConfigInfo().then((info) => {
        configInfo = info;
      }).catch(() => {});
    }
  });

  let detectedWorkspace = $derived(
    configInfo.workspace_path && configInfo.workspace_path !== '.'
      ? configInfo.workspace_path
      : workspaceState.workspacePath && workspaceState.workspacePath !== '.'
        ? workspaceState.workspacePath
        : '${workspaceFolder}'
  );

  let binaryPath = $derived(configInfo.executable_path || 'api_client_reborn');

  let generatedConfigJson = $derived.by(() => {
    return JSON.stringify(
      {
        mcpServers: {
          'api-client-reborn': {
            command: binaryPath,
            args: ['mcp', '--workspace', detectedWorkspace],
          },
        },
      },
      null,
      2
    );
  });

  let configFilePath = $derived.by(() => {
    switch (activeClient) {
      case 'cursor':
        return '.cursor/mcp.json (in project repository root)';
      case 'claude':
        return 'claude_desktop_config.json (Claude Desktop App Settings)';
      case 'antigravity':
        return '.gemini/settings.json or Antigravity MCP settings';
      default:
        return 'Standard MCP JSON-RPC configuration';
    }
  });

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(generatedConfigJson);
      copied = true;
      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        copied = false;
      }, 2000);
    } catch {
      // Fallback
    }
  }

  function closeModal() {
    workspaceState.isMcpModalOpen = false;
  }
</script>

{#if workspaceState.isMcpModalOpen}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Model Context Protocol Integration"
  >
    <!-- Modal Card -->
    <div
      class="w-full max-w-2xl bg-white dark:bg-[#1e1e1e] rounded-xl shadow-2xl border border-neutral-200 dark:border-[#333] flex flex-col overflow-hidden max-h-[90vh]"
    >
      <!-- Header -->
      <div class="px-5 py-4 border-b border-neutral-200 dark:border-[#2d2d2d] flex items-center justify-between bg-neutral-50/50 dark:bg-[#252526]">
        <div class="flex items-center gap-2.5">
          <div class="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <Bot size={18} />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
              <span>AI & Model Context Protocol (MCP)</span>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                v2024-11-05
              </span>
            </h2>
            <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              Empower Cursor, Claude Desktop, or Antigravity to discover, test, and write APIs in this workspace.
            </p>
          </div>
        </div>
        <button
          onclick={closeModal}
          class="p-1 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          title="Close modal (Esc)"
        >
          <X size={16} />
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
        <!-- Client Selector Tabs -->
        <div>
          <span class="block text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">
            Target AI Assistant
          </span>
          <div class="grid grid-cols-4 gap-1.5 p-1 bg-neutral-100 dark:bg-[#252526] rounded-lg border border-neutral-200 dark:border-[#333]">
            <button
              onclick={() => (activeClient = 'cursor')}
              class="py-1.5 px-2 rounded-md font-medium text-xs transition-colors flex items-center justify-center gap-1.5 {activeClient === 'cursor'
                ? 'bg-white dark:bg-[#333] text-neutral-900 dark:text-white shadow-sm font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}"
            >
              Cursor
            </button>
            <button
              onclick={() => (activeClient = 'claude')}
              class="py-1.5 px-2 rounded-md font-medium text-xs transition-colors flex items-center justify-center gap-1.5 {activeClient === 'claude'
                ? 'bg-white dark:bg-[#333] text-neutral-900 dark:text-white shadow-sm font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}"
            >
              Claude Desktop
            </button>
            <button
              onclick={() => (activeClient = 'antigravity')}
              class="py-1.5 px-2 rounded-md font-medium text-xs transition-colors flex items-center justify-center gap-1.5 {activeClient === 'antigravity'
                ? 'bg-white dark:bg-[#333] text-neutral-900 dark:text-white shadow-sm font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}"
            >
              Antigravity
            </button>
            <button
              onclick={() => (activeClient = 'generic')}
              class="py-1.5 px-2 rounded-md font-medium text-xs transition-colors flex items-center justify-center gap-1.5 {activeClient === 'generic'
                ? 'bg-white dark:bg-[#333] text-neutral-900 dark:text-white shadow-sm font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'}"
            >
              Generic MCP
            </button>
          </div>
        </div>

        <!-- Binary Runner Info -->
        <div class="flex items-center justify-between bg-neutral-50 dark:bg-[#252526] p-2.5 rounded-lg border border-neutral-200/80 dark:border-[#333]">
          <div>
            <div class="text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">Native Rust Binary Server</div>
            <div class="text-[10px] text-neutral-500 dark:text-neutral-400">
              Runs directly via the native desktop binary with zero Node.js dependencies.
            </div>
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            stdio
          </span>
        </div>

        <!-- Configuration Code Preview -->
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[11px] text-neutral-500 dark:text-neutral-400 flex items-center gap-1">
              <span>Paste into:</span>
              <code class="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-[#252526] font-mono text-neutral-800 dark:text-neutral-200 text-[10px]">
                {configFilePath}
              </code>
            </span>
            <button
              onclick={copyConfig}
              class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors {copied
                ? 'bg-emerald-500 text-white'
                : 'bg-neutral-100 hover:bg-neutral-200 dark:bg-[#2c2c2e] dark:hover:bg-[#38383a] text-neutral-800 dark:text-neutral-200 border border-neutral-300 dark:border-[#404040]'}"
            >
              {#if copied}
                <Check size={12} />
                <span>Copied!</span>
              {:else}
                <Copy size={12} />
                <span>Copy JSON</span>
              {/if}
            </button>
          </div>

          <pre
            class="p-3 bg-[#f8f9fa] dark:bg-[#151515] text-neutral-800 dark:text-neutral-200 rounded-lg border border-neutral-200 dark:border-[#2a2a2a] font-mono text-[11px] leading-relaxed overflow-x-auto select-all"
          >{generatedConfigJson}</pre>
        </div>

        <!-- Exposed Capabilities Grid -->
        <div class="pt-2 border-t border-neutral-100 dark:border-[#2a2a2a]">
          <span class="block text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">
            Exposed AI Tools
          </span>
          <div class="grid grid-cols-2 gap-2 text-[11px]">
            <div class="p-2 rounded bg-neutral-50 dark:bg-[#252526]/60 border border-neutral-200/60 dark:border-[#333]">
              <span class="font-mono font-bold text-blue-600 dark:text-blue-400">list_requests</span>
              <p class="text-neutral-500 dark:text-neutral-400 text-[10px] mt-0.5">Discovers all .curl, .grpcurl, and .grpc endpoints in workspace.</p>
            </div>
            <div class="p-2 rounded bg-neutral-50 dark:bg-[#252526]/60 border border-neutral-200/60 dark:border-[#333]">
              <span class="font-mono font-bold text-blue-600 dark:text-blue-400">get_request</span>
              <p class="text-neutral-500 dark:text-neutral-400 text-[10px] mt-0.5">Inspects method, URL, headers, and test assertions.</p>
            </div>
            <div class="p-2 rounded bg-neutral-50 dark:bg-[#252526]/60 border border-neutral-200/60 dark:border-[#333]">
              <span class="font-mono font-bold text-emerald-600 dark:text-emerald-400">execute_request</span>
              <p class="text-neutral-500 dark:text-neutral-400 text-[10px] mt-0.5">Runs HTTP requests with environment variables & secrets.</p>
            </div>
            <div class="p-2 rounded bg-neutral-50 dark:bg-[#252526]/60 border border-neutral-200/60 dark:border-[#333]">
              <span class="font-mono font-bold text-emerald-600 dark:text-emerald-400">execute_grpc_request</span>
              <p class="text-neutral-500 dark:text-neutral-400 text-[10px] mt-0.5">Runs gRPC unary and streaming requests with protobuf reflection.</p>
            </div>
            <div class="p-2 rounded bg-neutral-50 dark:bg-[#252526]/60 border border-neutral-200/60 dark:border-[#333]">
              <span class="font-mono font-bold text-emerald-600 dark:text-emerald-400">execute_quick_curl</span>
              <p class="text-neutral-500 dark:text-neutral-400 text-[10px] mt-0.5">Executes ad-hoc cURL commands against active environments.</p>
            </div>
            <div class="p-2 rounded bg-neutral-50 dark:bg-[#252526]/60 border border-neutral-200/60 dark:border-[#333]">
              <span class="font-mono font-bold text-emerald-600 dark:text-emerald-400">save_request</span>
              <p class="text-neutral-500 dark:text-neutral-400 text-[10px] mt-0.5">Writes newly generated requests and sidecars to disk.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-neutral-200 dark:border-[#2d2d2d] bg-neutral-50/50 dark:bg-[#252526] flex items-center justify-between">
        <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
          Secrets in <code class="font-mono text-[10px]">.apiclient/.secrets.env</code> are isolated and masked from AI prompts.
        </span>
        <button
          onclick={closeModal}
          class="px-3.5 py-1.5 rounded-md text-xs font-medium bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-700 dark:hover:bg-neutral-600 text-neutral-800 dark:text-neutral-100 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  </div>
{/if}
