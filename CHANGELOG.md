# Changelog

## [0.14.0] — 2026-11-13

### Changed

- **Linear-inspired developer-tool UI redesign**: Redesigned the entire application interface inspired by Linear, Raycast, and Zed for a high-density, fast, developer-first experience.
- **Unified semantic design tokens**: Replaced scattered hardcoded colors with unified CSS custom properties across dark (`#0d0e11` graphite) and light (`#fbfbfc` paper slate) appearances.
- **Modernized application shell**:
  - Compact 36px titlebar with macOS traffic lights inset, quick-access `⌘K` command palette pill, workspace selector with active checkmark, and environment indicator.
  - Collapsible icon/tree rail sidebar with SegmentedControl for Requests and History, search filter (`⌘F`), and context menus.
  - 34px high-density tab bar with color-coded method badges, dirty indicators, and OS-native close button placement.
- **Unified request playgrounds & response viewers**:
  - Aligned HTTP and gRPC primary request bars to a uniform 32px control height across method selector, endpoint URL input, discovery button, and Send (`⌘↵`) / Cancel action.
  - Restructured request tabs (Params, Headers, Body, Auth, Scripts) with monospace key-value editors, variable hover preview tooltips, and gRPC reflection/proto pickers.
  - High-density response viewer with color-coded status badges (2xx/3xx/4xx/5xx), timing/size metrics, copy/download actions, and test assertions.
- **Raycast/Linear style command palette (`⌘K`)**: Quick launcher for actions, requests, tabs, history entries, and environments.
- **Standardized UI primitives & modals**: Introduced reusable `Modal`, `SegmentedControl`, and `Kbd` micro-components across Environment variables, Request Save, Shortcuts, MCP, Import, Export, and Software Update dialogs.

## [0.13.4] — 2026-11-13

### Fixed

- Dynamically synchronize application version from native Tauri runtime so the in-app updater and titlebar reflect the true running binary version instead of remaining pinned to `v0.12.0`.
- Automatically synchronize running version upon updater initialization and checks, including when the application is already on the latest release.

## [0.13.3] — 2026-11-13

### Added

- Added gRPC to the request method selector, allowing unsaved drafts to switch between HTTP and gRPC while preserving saved requests by opening a new draft.

### Improved

- Simplified the sidebar New Request action; choose HTTP or gRPC from the request editor.

## [0.13.2] — 2026-11-13

### Fixed

- Corrected collection export labels to `.zip` and added native save-location selection for desktop exports.
- Replaced the sidebar New Folder prompt with an in-app dialog and surfaced folder-creation errors.

## [0.13.1] — 2026-11-13

### Added

- Export collections and the full workspace as ZIP archives containing the exact saved `.curl`, `.grpcurl`, and `.grpc` request files.
- Import request ZIP archives as new collections while preserving nested folders and avoiding overwrites.

## [0.12.1] — 2026-11-12

### Improved

- Unified dropdown styling and control heights across HTTP and gRPC requests.
- Simplified gRPC service and method selection with clear labels, single controls, and optional service discovery.

## [0.12.0] — 2026-11-12

### Added

- **Linear-inspired developer-tool UI**: introduced semantic light/dark design tokens, compact controls, denser hierarchy, and consistent panel styling across the application.
- **Collapsible workspace rail**: added a persisted sidebar icon rail for collections, search, and history navigation.
- **Resizable request/response workspace**: added persisted mouse and keyboard pane resizing with an accessible split control.
- **Command palette**: added `Cmd/Ctrl+K` search across actions, requests, tabs, history, and environments.
- **Keyboard navigation refinements**: added command-palette and sidebar shortcuts while preserving existing request, tab, and editor shortcuts.

### Changed

- Reworked the titlebar, request tabs, HTTP/gRPC editors, response viewer, and primary workspace shell around reusable UI primitives and semantic tokens.
- Preserved all existing request execution, IPC, persistence, environment, streaming, and backend behavior.

## [0.11.0] — 2026-11-12

### Added

- **Native Rust MCP Consolidation**: The compiled Rust binary (`api_client_reborn mcp --workspace <path>`) is now the sole supported MCP implementation. Removed legacy TypeScript MCP runtime, `bin/mcp.js`, and associated npm scripts.
- **Dedicated gRPC Execution (`execute_grpc_request`)**: Support for executing saved `.grpcurl` and `.grpc` requests using server reflection or local proto files, supporting unary, server-streaming, and client-streaming calls (via piped JSON `printf` syntax).
- **Rust grpcurl Parser**: Native command line parsing for grpcurl flags (`-plaintext`, `-insecure`, `-cacert`, `-proto`, `-import-path`, `-H`, `-d`), directive comments, and legacy JSON configs.
- **Canonical Workspace Path Validation**: Hardened workspace path validator strictly enforcing canonical root boundaries, rejecting absolute paths, traversal (`..`), NUL bytes, symlink escapes, and invalid request file extensions.
- **5-Tier Variable Precedence & Canonical `.secrets.env`**: Strict 5-tier resolution across default/selected environments, collection variables, `.secrets.env` (with comments/quotes/last-definition semantics), and per-call overrides, with metadata-only redaction.
- **Bounded Cancellable Execution**: Server-level `--max-response-bytes` limit (default 4 MiB) enforced across HTTP bodies, gRPC unary, and streamed payloads; standard JSON-RPC cancellation routing across concurrent requests, QuickJS scripts, and network streams.
- **Rich Tool Schemas & Annotations**: Complete nested JSON schemas with `additionalProperties: false`, string-map `variables`, and tool capability annotations (`readOnly`, `destructive`, `openWorldHint`).

## [0.10.2] — 2026-11-11

### Fixed

- Enable `createUpdaterArtifacts` in `tauri.conf.json` so Tauri v2 generates Minisign `.sig` signature archives across all platforms.
- Set `releaseDraft: false` in GitHub release workflow to publish releases and update manifest (`latest.json`) immediately.

## [0.10.1] — 2026-11-11

### Fixed

- Bound Ubuntu package installation retries and network timeouts in the release workflow so temporary mirror or DNS failures cannot stall release jobs indefinitely.

## [0.10.0] — 2026-11-11

### Added

- In-app software update capability powered by the official Tauri v2 Updater (`tauri-plugin-updater` and `@tauri-apps/plugin-updater`).
- Cryptographic Ed25519 signature verification using Minisign keys to ensure authenticity and integrity of all release archives.
- Automated update manifest (`latest.json`) generation and distribution via GitHub Releases workflow.
- Native macOS application menu item ("Check for Updates…") wired to frontend event bus.
- Full-featured Software Update modal with release notes preview, live downloading progress bar with downloaded byte metrics, and single-click restart.
- Subtle, non-blocking Titlebar update notification badge when new releases are detected in the background.
- Clean application relaunch command (`relaunch_app`) to seamlessly swap and apply updates.

## [0.9.0] — 2026-11-11

### Added

- Persist gRPC requests as plain, directly executable `grpcurl` commands with `# @name` and `# @timeout` comment directives, achieving full symmetry with `.curl` files.
- Standardized on the `.grpcurl` file extension for gRPC requests across the workspace, sidebar, and modals.
- Transparent backward compatibility: existing `.grpc` files and legacy JSON-formatted requests continue to be parsed and displayed seamlessly.
- Native Rust command-line parsing (`parse_grpc_method_from_command`) to extract gRPC `Service/Method` directly from command tokens in the workspace scanner.
- Updated collection export, MCP server tools, and starter examples to support `.grpcurl` requests.

## [0.8.0] — 2026-11-11

### Added

- Native Model Context Protocol (MCP) server running over JSON-RPC 2.0 stdio (`2024-11-05` spec), enabling AI coding assistants (Cursor, Claude Desktop, Antigravity, VS Code Copilot) to discover, inspect, execute, and generate API requests.
- Six core MCP tools: `list_requests`, `get_request`, `execute_request`, `execute_quick_curl`, `save_request`, and `list_environments`.
- Safe secret resolution and masking preventing secret exposure in LLM prompts while injecting credentials into network requests.
- Headless execution engine supporting pre/post JavaScript scripts and Chai test assertions (`pm.test()`, `pm.expect()`).
- Desktop app AI & MCP Integration modal (`McpModal.svelte`) with one-click configuration copying for Cursor, Claude Desktop, Antigravity, and NPX.
- Desktop binary CLI bridge: launching `api-client-reborn mcp --workspace <path>` executes the headless MCP server without launching the GUI.
- Executable runner script (`bin/mcp.js`) and comprehensive MCP documentation guide (`docs/MCP_GUIDE.md`).

## [0.7.0] — 2026-11-01

### Added

- Manage collection-level variables and secrets alongside workspace and environment variables in the Variables modal.
- Support collection variable precedence over environment and workspace variables with winning source identification in hover tooltips.
- Mask secret values in variable hover inspector by default with on-demand reveal via mouse click or `⌥ Option` / `Alt` key peek.
- Automatic `.gitignore` synchronization for collection secret files (`.apiclient/collection.secrets.json`).
- Sample collection (`examples/variable-resolution`) for verifying variable resolution and precedence rules.

## [0.6.0] — 2026-11-01

### Added

- Choose and switch the active workspace from the app title bar.
- Store app settings separately from workspace collections, environments, secrets, and request history.
- Migrate existing workspace data into the default workspace folder while preserving conflicting files.

### Changed

- Keep each workspace folder self-contained and open selected folders without adding starter content.

## [0.5.0] — 2026-11-01

### Added

- Import Postman environment exports and switch the active environment from the Variables menu.
- Import Postman collection variables and use them as the highest-priority variable scope.
- Upload files with multipart form requests and save file responses to disk.
- Add a live desktop app preview and the shipped application icon to the GitHub Pages site.

### Changed

- The Variables control now uses a compact label while showing the active environment.
- Document variable resolution order: collection variables, selected environment, then workspace values and secrets.
