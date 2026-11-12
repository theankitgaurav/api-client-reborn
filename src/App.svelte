<script lang="ts">
  import { onMount } from 'svelte';
  import Titlebar from '$lib/components/Titlebar.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import RequestPlayground from '$lib/components/RequestPlayground.svelte';
  import GrpcRequestPlayground from '$lib/components/GrpcRequestPlayground.svelte';
  import ResponseViewer from '$lib/components/ResponseViewer.svelte';
  import EnvModal from '$lib/components/EnvModal.svelte';
  import SaveRequestModal from '$lib/components/SaveRequestModal.svelte';
  import ImportModal from '$lib/components/ImportModal.svelte';
  import ExportModal from '$lib/components/ExportModal.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
  import McpModal from '$lib/components/McpModal.svelte';
  import UpdateModal from '$lib/components/UpdateModal.svelte';
  import CommandPalette from '$lib/components/ui/CommandPalette.svelte';
  import ResizableSplit from '$lib/components/ui/ResizableSplit.svelte';
  import { executeShortcut, type ShortcutContext } from '$lib/utils/shortcuts';
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { responseState } from '$lib/state/response.svelte';
  import { envState } from '$lib/state/env.svelte';
  import { shortcutsState } from '$lib/state/shortcuts.svelte';
  import { updaterState } from '$lib/state/updater.svelte';
  import { uiState } from '$lib/state/ui.svelte';

  onMount(() => {
    updaterState.init();
    return () => updaterState.destroy();
  });

  const shortcutContext: ShortcutContext = {
    createNewRequest: () => workspaceState.createNewRequest(),
    closeActiveTab: () => workspaceState.closeActiveTab(),
    closeOtherTabs: () => {
      if (workspaceState.activeTabId) {
        workspaceState.closeOtherTabs(workspaceState.activeTabId);
      }
    },
    nextTab: () => workspaceState.nextTab(),
    previousTab: () => workspaceState.previousTab(),
    selectTabByIndex: (idx) => workspaceState.selectTabByIndex(idx),
    selectLastTab: () => workspaceState.selectTabByIndex(workspaceState.tabs.length - 1),
    saveActiveFile: () => workspaceState.saveActiveFile(),
    handleSend: () => {
      if (responseState.isExecuting) {
        responseState.cancel();
      } else {
        responseState.runCurrentRequest();
      }
    },
    focusUrlInput: () => {
      const el = document.getElementById('request-url-input') as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.select();
      }
    },
    focusFilterInput: () => {
      const el = document.getElementById('sidebar-filter-input') as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.select();
      }
    },
    toggleCommandPalette: () => uiState.toggleCommandPalette(),
    toggleSidebar: () => uiState.toggleSidebar(),
    toggleVariablesModal: () => {
      envState.isVariablesModalOpen = !envState.isVariablesModalOpen;
    },
    closeActiveModal: () => {
      if (updaterState.isModalOpen && updaterState.status !== 'downloading') {
        updaterState.closeModal();
        return true;
      }
      if (shortcutsState.isCheatSheetOpen) {
        shortcutsState.closeCheatSheet();
        return true;
      }
      if (workspaceState.isSaveModalOpen) {
        workspaceState.isSaveModalOpen = false;
        return true;
      }
      if (workspaceState.isImportModalOpen) {
        workspaceState.isImportModalOpen = false;
        return true;
      }
      if (workspaceState.isExportModalOpen) {
        workspaceState.isExportModalOpen = false;
        return true;
      }
      if (workspaceState.isMcpModalOpen) {
        workspaceState.isMcpModalOpen = false;
        return true;
      }
      if (envState.isVariablesModalOpen) {
        envState.isVariablesModalOpen = false;
        return true;
      }
      return false;
    },
    toggleCheatSheet: () => shortcutsState.toggleCheatSheet(),
  };

  function handleKeyDown(e: KeyboardEvent) {
    executeShortcut(e, shortcutContext);
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<main class="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
  <!-- macOS Top Navigation & Traffic Lights -->
  <Titlebar />

  <!-- Main Workspace Layout -->
  <div class="flex-1 flex overflow-hidden">
    <!-- Left Sidebar: Collections & Files -->
    <Sidebar />

    <!-- Content Area: Full-width TabBar on top, parallel Request & Response panes below -->
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <!-- Request tabs spanning full width to the right -->
      <TabBar />

      <!-- Parallel Split View below TabBar -->
      <ResizableSplit>
        {#snippet request()}
          {#if workspaceState.activeTab?.requestType === 'grpc'}
            <GrpcRequestPlayground />
          {:else}
            <RequestPlayground />
          {/if}
        {/snippet}
        {#snippet response()}
          <ResponseViewer />
        {/snippet}
      </ResizableSplit>
    </div>
  </div>

  <!-- Local Variables & Secrets Modal -->
  <EnvModal />

  <!-- Save New Request Modal -->
  <SaveRequestModal />

  <!-- Collection / Request Import Modal -->
  <ImportModal />

  <!-- Collection Shell Script Export Modal -->
  <ExportModal />

  <!-- Keyboard Shortcuts Cheat Sheet Modal -->
  <ShortcutsModal />

  <!-- AI & Model Context Protocol (MCP) Modal -->
  <McpModal />

  <!-- In-App Software Update Modal -->
  <UpdateModal />
  <CommandPalette />
</main>
