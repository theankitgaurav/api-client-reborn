# E2E Test Infra: api-client-reborn Context Menu Operations

## Test Philosophy
- Opaque-box, requirement-driven. Derives from `ORIGINAL_REQUEST.md` specifications.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Scenarios.
- Native Node.js test runner (`node:test`, `node:assert/strict`) with `--experimental-strip-types`, seamlessly integrated into `npm run test:frontend`.
- Rust unit tests in `src-tauri/src/ipc/workspace_commands.rs` run via `cargo test`.

## Feature Inventory
| # | Feature | Source | Tier 1 | Tier 2 | Tier 3 |
|---|---------|--------|:------:|:------:|:------:|
| 1 | New Request Here | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 2 | New Subfolder | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 3 | Export Collection (.sh) | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 4 | Rename Folder | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 5 | Delete Folder | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 6 | Open in New Tab | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 7 | Open in Current Tab | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 8 | Copy as cURL | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 9 | Duplicate Request | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 10 | Rename Request | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 11 | Delete Request | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |

## Test Architecture
- Test files:
  - `tests/tab-sync.test.ts`: Pure workspace synchronization, path resolution, tab cascading, strict prefix filtering, duplicate naming, rename extension preservation.
  - `tests/workspace-context-menu.test.ts`: Integration and end-to-end operation tests for all 11 context menu actions.
- Test runner invocation: `npm run test:frontend` (configured in `package.json`).
- Backend filesystem tests: `cargo test --manifest-path src-tauri/Cargo.toml`.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Deep nested folder hierarchy creation, new request creation, folder rename cascading, and recursive deletion | F1, F2, F3, F4, F5 | High |
| 2 | Multi-tab workflow with mixed pinned, dirty, and preview tabs, switching and opening in current tab | F6, F7, F8, F12 | High |
| 3 | Cloning request collection, duplicating with sidecars, renaming grpcurl/curl preserving extension, exporting bash script | F4, F9, F10, F11 | High |
| 4 | Sibling folder isolation test: delete folder with common prefix (`/api/v1` vs `/api/v1-legacy`) without affecting sibling tabs | F5, F6, F12 | High |
| 5 | Request command resolution with active environment variables and fallback clipboard copy | F8, F9 | Medium |

## Coverage Thresholds
- Tier 1: ≥5 per feature (11 features × 5 = 55 test cases)
- Tier 2: ≥5 boundary & corner cases per feature (11 features × 5 = 55 test cases)
- Tier 3: Pairwise coverage of major feature interactions (≥11 test cases)
- Tier 4: ≥5 realistic application scenarios
- **Total Minimum Target: ~126 test cases**
