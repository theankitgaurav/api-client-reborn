<script lang="ts">
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { getMcpConfigInfo, type McpConfigInfo } from '$lib/ipc';
  import { Copy, Check, Bot } from '$lib/components/icons';
  import Modal from '$lib/components/ui/Modal.svelte';
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';

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

<Modal
  isOpen={workspaceState.isMcpModalOpen}
  title="AI & Model Context Protocol (MCP)"
  description="Connect Cursor, Claude Desktop, or Antigravity to your API workspace."
  maxWidth="2xl"
  onclose={closeModal}
>
  {#snippet icon()}
    <Bot size={16} class="text-[var(--accent)]" />
  {/snippet}

  <div class="p-4 space-y-4 text-xs bg-[var(--surface)]">
    <!-- Client Selector Tabs -->
    <div>
      <div class="text-[10px] font-semibold text-[var(--text-subtle)] uppercase tracking-wider mb-2">
        Target AI Assistant
      </div>
      <SegmentedControl
        items={[
          { id: 'cursor', label: 'Cursor' },
          { id: 'claude', label: 'Claude Desktop' },
          { id: 'antigravity', label: 'Antigravity' },
          { id: 'generic', label: 'Generic MCP' },
        ]}
        activeId={activeClient}
        onchange={(id) => (activeClient = id as typeof activeClient)}
        size="sm"
        class="w-full justify-center"
      />
    </div>

    <!-- Binary Info -->
    <div class="flex items-center justify-between bg-[var(--surface-muted)] p-2.5 rounded border border-[var(--border)]">
      <div>
        <div class="text-[11px] font-semibold text-[var(--text-strong)]">Native Rust Binary Server</div>
        <div class="text-[10px] text-[var(--text-muted)]">
          Runs directly via native desktop binary with zero Node.js dependencies.
        </div>
      </div>
      <span class="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)] border border-[color-mix(in_srgb,var(--accent)_25%,transparent)]">
        stdio
      </span>
    </div>

    <!-- Config Preview -->
    <div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
          <span>Config file:</span>
          <code class="px-1.5 py-0.5 rounded bg-[var(--surface-muted)] border border-[var(--border)] font-mono text-[10px] text-[var(--text-strong)]">
            {configFilePath}
          </code>
        </span>
        <button
          onclick={copyConfig}
          class="ui-button ui-button-secondary h-6.5 px-2.5 text-[11px]"
        >
          {#if copied}
            <Check size={11} class="text-[var(--success)]" />
            <span class="text-[var(--success)]">Copied!</span>
          {:else}
            <Copy size={11} />
            <span>Copy JSON</span>
          {/if}
        </button>
      </div>

      <pre class="p-3 bg-[var(--surface-muted)] text-[var(--text-strong)] rounded border border-[var(--border)] font-mono text-[11px] leading-relaxed overflow-x-auto select-all">{generatedConfigJson}</pre>
    </div>

    <!-- Exposed Tools -->
    <div class="pt-2 border-t border-[var(--border)]">
      <span class="block text-[10px] font-semibold text-[var(--text-subtle)] uppercase tracking-wider mb-2">
        Available MCP Tools
      </span>
      <div class="grid grid-cols-2 gap-2 text-[11px]">
        <div class="p-2 rounded bg-[var(--surface-muted)] border border-[var(--border)]">
          <span class="font-mono font-bold text-[var(--accent)]">list_requests</span>
          <p class="text-[var(--text-muted)] text-[10px] mt-0.5">Discovers all .curl, .grpcurl endpoints in workspace.</p>
        </div>
        <div class="p-2 rounded bg-[var(--surface-muted)] border border-[var(--border)]">
          <span class="font-mono font-bold text-[var(--accent)]">get_request</span>
          <p class="text-[var(--text-muted)] text-[10px] mt-0.5">Inspects method, URL, headers, and test assertions.</p>
        </div>
        <div class="p-2 rounded bg-[var(--surface-muted)] border border-[var(--border)]">
          <span class="font-mono font-bold text-[var(--success)]">execute_request</span>
          <p class="text-[var(--text-muted)] text-[10px] mt-0.5">Runs HTTP requests with environment variables & secrets.</p>
        </div>
        <div class="p-2 rounded bg-[var(--surface-muted)] border border-[var(--border)]">
          <span class="font-mono font-bold text-[var(--success)]">execute_grpc_request</span>
          <p class="text-[var(--text-muted)] text-[10px] mt-0.5">Runs gRPC unary and streaming requests with reflection.</p>
        </div>
      </div>
    </div>
  </div>

  {#snippet footer()}
    <span class="text-[10px] text-[var(--text-subtle)] mr-auto">
      Secrets in <code class="font-mono">.apiclient/.secrets.env</code> are isolated and masked.
    </span>
    <button
      type="button"
      onclick={closeModal}
      class="ui-button ui-button-primary h-7 px-3.5 text-[11px]"
    >
      Done
    </button>
  {/snippet}
</Modal>
