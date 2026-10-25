<script lang="ts">
  import Titlebar from '$lib/components/Titlebar.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import RequestPlayground from '$lib/components/RequestPlayground.svelte';
  import ResponseViewer from '$lib/components/ResponseViewer.svelte';
  import EnvModal from '$lib/components/EnvModal.svelte';
  import SaveRequestModal from '$lib/components/SaveRequestModal.svelte';
  import ImportModal from '$lib/components/ImportModal.svelte';
  import ExportModal from '$lib/components/ExportModal.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
  import { executeShortcut, type ShortcutContext } from '$lib/utils/shortcuts';
  import { workspaceState } from '$lib/state/workspace.svelte';
  import { responseState } from '$lib/state/response.svelte';
  import { envState } from '$lib/state/env.svelte';
  import { shortcutsState } from '$lib/state/shortcuts.svelte';

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
    toggleVariablesModal: () => {
      envState.isVariablesModalOpen = !envState.isVariablesModalOpen;
    },
    closeActiveModal: () => {
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

<main class="h-screen w-screen flex flex-col bg-[#f5f5f7] dark:bg-[#181818] text-[#1d1d1f] dark:text-[#cccccc] overflow-hidden">
  <!-- macOS Top Navigation & Traffic Lights -->
  <Titlebar />

  <!-- Main Workspace Layout -->
  <div class="flex-1 flex overflow-hidden">
    <!-- Left Sidebar: Collections & Files -->
    <Sidebar />

    <!-- Content Area: Full-width TabBar on top, parallel Request & Response panes below -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <!-- Request tabs spanning full width to the right -->
      <TabBar />

      <!-- Parallel Split View below TabBar -->
      <div class="flex-1 flex min-h-0 overflow-hidden">
        <!-- Request Editor Pane -->
        <RequestPlayground />

        <!-- Response Viewer Pane -->
        <ResponseViewer />
      </div>
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
</main>
