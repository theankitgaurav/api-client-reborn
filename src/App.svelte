<script lang="ts">
  import Titlebar from '$lib/components/Titlebar.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import RequestEditor from '$lib/components/RequestEditor.svelte';
  import ResponseViewer from '$lib/components/ResponseViewer.svelte';
  import EnvModal from '$lib/components/EnvModal.svelte';
</script>

<main class="h-screen w-screen flex flex-col bg-[#181818] text-[#cccccc] overflow-hidden">
  <!-- macOS Top Navigation & Traffic Lights -->
  <Titlebar />

  <!-- 3-Column Split View -->
  <div class="flex-1 flex overflow-hidden">
    <!-- Left Sidebar: Collections & Files -->
    <Sidebar />

    <!-- Center Editor: cURL & Metadata -->
    <RequestEditor />

    <!-- Right Viewer: Status, Response, Stream Logs -->
    <ResponseViewer />
  </div>

  <!-- Local Secrets Modal -->
  <EnvModal />
</main>
