# Changelog

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
