<script lang="ts">
  import Titlebar from '$lib/components/Titlebar.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
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

  <!-- 3-Column Split View -->
  <div class="flex-1 flex overflow-hidden">
    <!-- Left Sidebar: Collections & Files -->
    <Sidebar />

    <!-- Center Playground: Postman-like Request Editor -->
    <RequestPlayground />

    <!-- Right Viewer: Status, Response, Stream Logs -->
    <ResponseViewer />
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
