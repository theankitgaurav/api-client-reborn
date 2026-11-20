---
name: security-review
description: Review changes to workspace filesystem boundaries, MCP secret resolution, request execution, and release signing in this repo.
---

# Security review

## Trust boundaries in this repo
- `src-tauri/src/fs/workspace_path.rs` must keep reads and writes beneath the canonical workspace root.
- `src-tauri/src/mcp.rs` is the stdio JSON-RPC boundary; validate request paths and redact secret values before metadata leaves the workspace.
- `src-tauri/src/env/resolver.rs` and `src-tauri/src/env/secret_file.rs` resolve workspace secrets and per-call variables.
- `src-tauri/src/engine/http.rs`, `src-tauri/src/engine/grpc.rs`, and `src-tauri/src/mcp.rs` execute untrusted request files and scripts.

## Never
- Leave workspace reads or writes outside the canonical root validated by `WorkspacePathValidator`.
- Return secret values from MCP metadata; key-based redaction must remain based on the canonical `.apiclient/.secrets.env` store.
- Reintroduce legacy JSON secret stores for MCP variable resolution.
- Bypass response-byte limits, cancellation, or certificate controls in HTTP/gRPC execution.
- Place Tauri signing or GitHub credentials in tracked source, manifests, or updater public-key fields.

## Before merging a change to these surfaces
- Run `npm run test:backend`, `npm run test:frontend`, and `npm test` for the affected change.
- Exercise `src-tauri/src/fs/workspace_path.rs` tests for traversal, absolute paths, symlinks, and invalid extensions.
- Verify MCP metadata redaction and workspace secret precedence with existing tests.
- For release workflow changes, run `.github/scripts/validate-release.mjs` and review the signing and publishing steps.
