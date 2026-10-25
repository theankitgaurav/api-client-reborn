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
</script>

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
</main>
