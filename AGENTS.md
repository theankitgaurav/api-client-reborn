# Repository instructions

## Commands

- Install dependencies: `npm ci --legacy-peer-deps`
- Run the full verification suite: `npm test`
- Run frontend/compiler checks: `npm run check`
- Run frontend tests: `npm run test:frontend`
- Run Rust tests: `npm run test:backend`
- Run the frontend: `npm run dev`
- Run the desktop app: `npm run tauri dev`
- Build frontend assets: `npm run build`
- Build desktop packages: `npm run tauri build`

The active toolchain is Node 22 and stable Rust; use the scripts in `package.json` rather than invoking ad-hoc equivalents.

## Conventions

- Keep Svelte components in `src/lib/components/` and shared state in `src/lib/state/`; use the existing runes-style Svelte 5 patterns.
- Keep reusable frontend logic in `src/lib/utils/` and Rust IPC/network/filesystem logic in `src-tauri/src/`.
- Register Tauri commands and capabilities in `src-tauri/src/lib.rs`, `src-tauri/src/ipc/`, and `src-tauri/capabilities/default.json` as a matching chain.
- Preserve workspace path containment: read and write filesystem paths through `src-tauri/src/fs/workspace_path.rs`; do not bypass its canonical-root checks.
- Keep workspace secret resolution on `.apiclient/.secrets.env`; legacy JSON secret stores are not an MCP secret source.
- Add tests beside the two existing lanes: Node tests under `tests/` and Rust tests in `src-tauri/src/` or Cargo modules.
- Before agreeing that behavior is untestable, search both test lanes for existing precedent for the API or state involved.

## Maintenance matrix

| Change | Also update |
|---|---|
| Add or rename an MCP tool | `src-tauri/src/mcp.rs`, `docs/MCP_GUIDE.md`, `README.md`, and frontend tests or Rust MCP tests |
| Change workspace request/environment/secret formats | The relevant parser or resolver under `src-tauri/src/`, migration behavior if workspaces need it, `docs/MCP_GUIDE.md`, and tests |
| Change the Svelte UI | The owning component, shared state or utilities in `src/`, and `tests/` coverage when behavior changes |
| Prepare a release | `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `CHANGELOG.md`, and `.github/workflows/release.yml` |
| Change Tauri capabilities or IPC | `src-tauri/capabilities/default.json`, `src-tauri/src/ipc/`, and `src-tauri/src/lib.rs` |
| Change CI or release automation | `.github/workflows/`, `.github/scripts/validate-release.mjs`, and release documentation in `README.md` |

## Done means

- `npm test` exits successfully.
- Any behavior change has a new or modified test that fails against the old implementation.
- Release changes pass `.github/scripts/validate-release.mjs` and the version checks in `.github/workflows/release.yml`.

## Never merges without a human

A person has to have **read this diff** before it lands. Telling an agent "merge it when you're done" is
approving a goal, not this change — so it does not count for anything on this list. Everywhere else it counts
fine, which is the point of having a list.

- Anything changing `.github/workflows/release.yml`, Tauri signing secrets, or GitHub release publishing behavior.
- Anything changing workspace secret resolution or the canonical `.apiclient/.secrets.env` handling.
- Anything changing `src-tauri/src/fs/workspace_path.rs` or MCP filesystem boundaries.
- Any release whose version fields or changelog entry cannot be machine-validated by the existing scripts.
