# Project: api-client-reborn Context Menus & Tab Synchronization

## Architecture
- **UI Layer (`src/lib/components/`)**:
  - `Sidebar.svelte`: Requests pane rendering collection folders and request items. Renders context menus on right-click and three-dot buttons.
  - `SaveRequestModal.svelte`: Modal for saving new requests into root or nested folders.
  - `ExportModal.svelte`: Modal for generating and exporting executable collection bash scripts.
- **State Layer (`src/lib/state/`)**:
  - `workspace.svelte.ts`: Svelte 5 reactive store holding `tabs`, `activeTabId`, `targetNewRequestFolder`, and actions (`openRequest`, `closeTab`, `renameItem`, `deleteItem`, `duplicateRequest`, etc.).
- **Pure Synchronization Utilities (`src/lib/utils/workspace-sync.ts`)**:
  - Extracted pure logic for tab path cascading, strict prefix matching on folder delete, force closing tabs, tab replacement in "Open in Current Tab", nested relative path resolution, and duplicate naming. Enables full Node.js testability.
- **IPC / Backend Layer (`src/lib/ipc.ts` & `src-tauri/src/ipc/workspace_commands.rs`)**:
  - Desktop: Tauri commands for `save_request_file`, `create_collection_folder`, `rename_workspace_item`, `delete_workspace_item`, `duplicate_request_file`.
  - Browser/Mock: In-memory mock tree keeping synchronization with all mutating operations.
- **Testing Architecture (`tests/` & `src-tauri/`)**:
  - Node.js test runner (`node:test`, `--experimental-strip-types`) in `tests/`.
  - Rust cargo tests in `src-tauri/`.

## Feature Inventory
Every feature from the Survey phase and user requirements is cataloged and assigned to a milestone:

| # | Feature | Description | Milestone | Status |
|---|---------|-------------|-----------|--------|
| F1 | Tab Sync Utilities | Pure functions for tab path cascading, strict prefix match on delete, force close, and tab replacement | M1 | DONE |
| F2 | New Request Here | Resolve full nested relative folder paths in Sidebar and SaveRequestModal; resolve relative paths in backend `save_request_file` | M2 | DONE |
| F3 | New Subfolder | Subfolder creation under selected parent directory, hierarchy resolution, refreshTree and mock tree sync | M2 | DONE |
| F4 | Export Collection (.sh) | Flatten all requests recursively, zero-dependency bash script with active variables, include unsaved changes from background tabs | M2 | DONE |
| F5 | Rename Folder | Rename directory on disk, normalize trailing slashes, synchronously cascade path updates to open tabs inside directory | M2 | DONE |
| F6 | Delete Folder | Recursively delete folder on disk, strict prefix matching (no sibling folder false match), cleanly force-close tabs without dirty prompt | M2 | DONE |
| F7 | Open in New Tab | Open request in new pinned tab and focus it without altering or closing existing tabs | M3 | DONE |
| F8 | Open in Current Tab | Replace currently active tab if unpinned or clean, preserve tab position and request state | M3 | DONE |
| F9 | Copy as cURL | Extract clean resolved executable command with active variables, write to clipboard with fallback, display visual confirmation feedback | M3 | DONE |
| F10 | Duplicate Request | Clone request file and `.meta.json` sidecar with unique `<stem>_copy.curl`, update `# @name` comment header to include "(Copy)", open in tab | M3 | DONE |
| F11 | Rename Request | Safely rename file preserving valid extension (`.curl` or `.grpcurl`), update `# @name` in file content, sync tab title and path | M3 | DONE |
| F12 | Delete Request | Delete file and `.meta.json` sidecar from disk, force-close tab without redundant dirty prompt | M3 | DONE |
| F13 | Automated Test Suite (E2E Track) | Automated regression test suite in `tests/` covering all 11 operations, nested resolution, tab sync, prefix matching, extension preservation | M-E2E / M4 | DONE |
| F14 | Verification Quality Bar | Svelte check (`npm run check`), frontend tests (`npm run test:frontend`), backend tests (`npm run test:backend`), production build (`npm run build`) | M4 | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Workspace Sync Utilities & Tab Store | Pure sync functions in `workspace-sync.ts` & integration in `workspace.svelte.ts` (F1, F8) | none | DONE |
| M2 | Folder Context Menu Operations | "New Request Here", "New Subfolder", "Export Collection", "Rename Folder", "Delete Folder" (F2, F3, F4, F5, F6) | M1 | DONE |
| M3 | Request Item Context Menu Operations | "Open in New Tab", "Open in Current Tab", "Copy as cURL", "Duplicate Request", "Rename Request", "Delete Request" (F7, F8, F9, F10, F11, F12) | M1 | DONE |
| M-E2E | Automated Regression Test Suite | E2E Testing Track creating test runner and test cases in `tests/` (Tiers 1-4) (F13) | none (parallel) | DONE |
| M4 | Final Milestone: 100% E2E Test Pass & Hardening | Run all E2E tests, pass full quality bar (`npm run check`, `npm run test:frontend`, `npm run test:backend`, `npm run build`), adversarial hardening | M2, M3, M-E2E | DONE |

## Interface Contracts
### `workspace-sync.ts` ↔ `workspace.svelte.ts`
- `cascadeFolderRename(tabs: TabItem[], oldPath: string, newPath: string): TabItem[]`
  - Strips trailing slashes from `oldPath` and `newPath`.
  - Matches tabs whose `filePath` equals `oldPath` or starts with `oldPath + '/'`.
  - Returns updated tab array with new `filePath` while preserving all other tab state.
- `filterTabsOnFolderDelete(tabs: TabItem[], deletedFolderPath: string): { remainingTabs: TabItem[], closedTabs: TabItem[] }`
  - Normalized boundary: matches `filePath === deletedFolderPath || filePath.startsWith(deletedFolderPath.replace(/\/+$/, '') + '/')`.
  - Does NOT match sibling folders (e.g. `/workspace/auth` does NOT match `/workspace/auth-helpers/login.curl`).
- `resolveTargetTabForOpenCurrent(tabs: TabItem[], activeTabId: string | null): { tabToReplace: TabItem | null, shouldAppend: boolean }`
  - Checks `activeTab` first: if active tab is clean (`!isDirty`) and unpinned (`!isPinned`), returns `tabToReplace: activeTab`.
  - If active tab is not clean/unpinned, checks for another unpinned and clean preview tab.
  - Otherwise returns `shouldAppend: true`.
- `formatDuplicateRequestName(stem: string, existingNames: string[], ext?: string): string`
  - Generates `<stem>_copy.<ext>` or `<stem>_copy_{n}.<ext>`.
- `sanitizeRequestRename(currentPath: string, newNameInput: string): string`
  - Preserves original extension (`.curl` or `.grpcurl`) even if omitted or mismatched by user input.
- `updateRequestNameHeader(rawContent: string, newDisplayName: string): string`
  - Updates or adds `# @name <newDisplayName>` comment line.

### Sidebar / SaveRequestModal ↔ Workspace State
- `createNewRequestInFolder(folderRelativePath: string): void`
  - `folderRelativePath` must be the complete relative directory path from workspace root (e.g. `collections/nested/auth`), not just the leaf name.
- `getFolderList(tree: WorkspaceItem[]): Array<{ path: string, label: string }>`
  - Generates entries where `path` contains the full nested relative path.

## Code Layout
- `src/lib/utils/workspace-sync.ts`: Pure workspace synchronization and path handling logic.
- `src/lib/state/workspace.svelte.ts`: Tab state and workspace actions delegating to pure sync utilities.
- `src/lib/components/Sidebar.svelte`: Context menu UI handlers and buttons for folder & request items.
- `src/lib/components/SaveRequestModal.svelte`: Modal for saving new requests with nested path selection.
- `src/lib/components/ExportModal.svelte`: Modal for exporting collections including in-memory dirty tabs.
- `src/lib/ipc.ts`: Frontend Tauri IPC wrappers with in-sync mock implementations.
- `src-tauri/src/ipc/workspace_commands.rs`: Rust Tauri command implementations for filesystem operations.
- `tests/tab-sync.test.ts` & `tests/workspace-context-menu.test.ts`: Automated regression tests.
- `package.json`: Test script configuration.
