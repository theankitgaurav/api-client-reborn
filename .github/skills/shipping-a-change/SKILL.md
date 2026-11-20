---
name: shipping-a-change
description: What to update when you change something in this repo, and what "done" requires. Use before opening a pull request.
---

# Shipping a change

## Add or change an MCP tool
1. Add or update the tool implementation in `src-tauri/src/mcp.rs`.
2. Register or adjust matching IPC behavior under `src-tauri/src/ipc/` only when the tool crosses the Tauri boundary.
3. Update `docs/MCP_GUIDE.md` and the README MCP feature summary.
4. Add a Rust or Node test under `src-tauri/src/` or `tests/`.
5. Run `npm test`.

## When you change this, also change that
| Change | Also update |
|---|---|
| `src-tauri/src/mcp.rs` | `docs/MCP_GUIDE.md`, `README.md`, and MCP tests |
| Workspace request/environment/secret formats | The parser or resolver in `src-tauri/src/`, migration behavior, `docs/MCP_GUIDE.md`, and tests |
| Svelte UI behavior | The owning component, shared state/utilities in `src/`, and behavior tests |
| Release version | `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `CHANGELOG.md`, and `.github/workflows/release.yml` |
| Tauri permissions or IPC | `src-tauri/capabilities/default.json`, `src-tauri/src/ipc/`, and `src-tauri/src/lib.rs` |
| CI or release automation | `.github/workflows/`, `.github/scripts/validate-release.mjs`, and README release guidance |

## Done
- `npm test` exits successfully.
- Any behavior change has a new or modified test that fails against the old implementation.
- Release changes pass `.github/scripts/validate-release.mjs` and the version checks in `.github/workflows/release.yml`.
