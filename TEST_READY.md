# Test Suite Ready: Requests Context Menus & Tab Synchronization

**Date**: 2026-10-25  
**Author**: `test_writer_e2e`  
**Status**: COMPLETE & 100% PASSING  
**Coverage Standard**: TEST_INFRA.md (Tiers 1, 2, 3, 4)

---

## 1. Executive Summary

A comprehensive automated regression test suite has been implemented covering all 11 Requests pane three-dot context menu operations (5 Folder operations and 6 Request Item operations) and tab synchronization mechanics, satisfying all acceptance criteria in `ORIGINAL_REQUEST.md`, `PROJECT.md`, and `TEST_INFRA.md`.

All tests run natively with `node:test` and `node:assert/strict` via `--experimental-strip-types`, executing 219 tests in under 450ms.

---

## 2. Test Files Created & Updated

| File | Status | Test Count | Description |
|---|---|:---:|---|
| `tests/tab-sync.test.ts` | **NEW** | **62** | Pure tab synchronization, path cascading, strict prefix filtering, tab replacement logic, duplicate naming, rename extension preservation. |
| `tests/workspace-context-menu.test.ts` | **NEW** | **126** | End-to-end simulated context menu workflows across all 11 operations, pairwise interactions, and real-world multi-step scenarios. |
| `package.json` | **UPDATED** | — | Updated `test:frontend` script to execute all test files seamlessly. |
| *Existing Suites* | Unchanged | 31 | `utils`, `scripts`, `postman-importer`, `collection-exporter`, `variable-tooltip`, `shortcuts`, `stream-resilience`. |
| **Total Frontend Suite** | **ACTIVE** | **219** | **219 passed, 0 failed (100% green)** |

---

## 3. Coverage Matrix Across All 11 Operations & 4 Tiers

| # | Operation / Feature | Tier 1 (Feature) | Tier 2 (Boundary & Corner) | Tier 3 (Pairwise) | Tier 4 (Real-World) | Total Tests |
|---|---------------------|:----------------:|:--------------------------:|:-----------------:|:-------------------:|:-----------:|
| 1 | New Request Here | 5 | 5 | ✓ | ✓ | **10+** |
| 2 | New Subfolder | 5 | 5 | ✓ | ✓ | **10+** |
| 3 | Export Collection (.sh) | 5 | 5 | ✓ | ✓ | **10+** |
| 4 | Rename Folder | 5 | 6 | ✓ | ✓ | **11+** |
| 5 | Delete Folder | 5 | 6 | ✓ | ✓ | **11+** |
| 6 | Open in New Tab | 5 | 5 | ✓ | ✓ | **10+** |
| 7 | Open in Current Tab | 5 | 5 | ✓ | ✓ | **10+** |
| 8 | Copy as cURL | 5 | 5 | ✓ | ✓ | **10+** |
| 9 | Duplicate Request | 5 | 5 | ✓ | ✓ | **10+** |
| 10 | Rename Request | 5 | 5 | ✓ | ✓ | **10+** |
| 11 | Delete Request | 5 | 5 | ✓ | ✓ | **10+** |
| — | Pure Tab Sync Utilities | 30 | 32 | — | — | **62** |
| — | Cross-Feature Interactions | — | — | 11 | — | **11** |
| — | Real-World Workflows | — | — | — | 5 | **5** |
| **Total Test Count** | | **85** | **87** | **11** | **5** | **188 (New)** |

*(Target was ≥126 tests; achieved 188 new tests, 149% of target threshold).*

---

## 4. Key Behaviors & Edge Cases Verified

### Folder Operations (R1)
1. **New Request Here**:
   - Exact nested folder path preservation (`collections/v1/auth`), setting `targetNewRequestFolder`.
   - Normalization of trailing slashes (`api/v1///` -> `api/v1`).
   - Deep hierarchy resolution up to 5 levels deep (`a/b/c/d/e/deep.curl`).
   - Saving draft clears dirty flag and inserts item into workspace tree.
2. **New Subfolder**:
   - Subfolder creation under root (`.`) and arbitrary nested folders.
   - Trimming whitespace and directory traversal sanitization (`../../evil` -> `.._.._evil`).
   - Rejection of empty or whitespace-only names.
3. **Export Collection (.sh)**:
   - Recursive request gathering across nested directories.
   - Variable substitution (`{{baseUrl}}`, `{{token}}`).
   - Prioritization of in-memory dirty tabs over stale disk content.
   - Zero-dependency bash script generation with HTTP status checks and gRPC command handling.
4. **Rename Folder**:
   - Directory renaming cascading to all open tabs residing within directory.
   - Preservation of dirty state, response snapshots, pinned status, and raw content.
   - Trailing slash stripping on `oldPath` and `newPath`.
   - Updating `targetNewRequestFolder` if it pointed to renamed directory hierarchy.
5. **Delete Folder**:
   - Strict prefix matching: deleting `/auth` does NOT match `/auth-helpers` or `/auth_backup`.
   - Numeric sibling isolation: deleting `/api/v1` does NOT match `/api/v10` or `/api/v100`.
   - Clean closure of all tabs within folder without redundant unsaved-changes confirmation.
   - Focus shifting to adjacent tab, or generating clean untitled draft tab if workspace becomes empty.

### Request Item Operations (R2)
6. **Open in New Tab**:
   - Unopened request opens in new pinned tab at end of list and receives focus.
   - Existing preview tab promoted to pinned tab on `openInNewTab`.
   - Existing pinned tab focused without duplicating tab.
   - Sidecar metadata loaded into tab.
7. **Open in Current Tab**:
   - Replaces active preview clean tab in place at exact same array index.
   - Does NOT replace active tab if active tab is dirty or pinned (appends new preview tab).
   - Targets active tab (e.g. index 2) over unrelated preview tabs at index 0.
   - Focuses existing tab if request file is already open.
8. **Copy as cURL**:
   - Merged active environment variables and dynamic generators (`{{$uuid}}`, `{{$timestamp}}`) resolved.
   - Metadata headers (`# @name`, `# @timeout`) stripped from copied command.
   - Reads from in-memory dirty tab if request is actively open.
   - Fallback clipboard handling when `navigator.clipboard` throws or is unavailable.
9. **Duplicate Request**:
   - Unique name generation: `<stem>_copy.curl`, `<stem>_copy_2.curl`, `<stem>_copy_3.curl`.
   - `# @name` updated to include `(Copy)`.
   - Companion `.meta.json` sidecar copied alongside request file.
   - New duplicate opened in a new pinned tab and focused.
   - Preservation of `.grpcurl` extension on gRPC duplicates.
10. **Rename Request**:
    - Extension preservation: typing name without extension keeps `.curl` or `.grpcurl`.
    - Mismatched extension replaced (e.g. typing `.json` enforces `.curl`).
    - Updating `# @name` in file content and sidecar name.
    - Synchronizing active tab title, path, and raw content.
11. **Delete Request**:
    - Request file and `.meta.json` sidecar deleted from disk and tree.
    - Matching tab force-closed cleanly without unsaved confirmation prompt.
    - Active focus shifted to adjacent open tab or fallback draft created.

---

## 5. Verification Command Execution Results

### 1. Frontend Test Suite: `npm run test:frontend`
```bash
> api-client-reborn@0.1.0 test:frontend
> node --test --experimental-strip-types tests/utils.test.ts tests/scripts.test.ts tests/postman-importer.test.ts tests/collection-exporter.test.ts tests/variable-tooltip.test.ts tests/shortcuts.test.ts tests/stream-resilience.test.ts tests/tab-sync.test.ts tests/workspace-context-menu.test.ts

ℹ tests 219
ℹ suites 0
ℹ pass 219
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 422.465
Exit code: 0
```

### 2. Svelte Check: `npm run check`
```bash
> api-client-reborn@0.1.0 check
> svelte-check

Loading svelte-check in workspace: /Users/anku/Projects/api-client-reborn
Getting Svelte diagnostics...

svelte-check found 0 errors and 0 warnings
Exit code: 0
```

### 3. Backend Rust Tests: `npm run test:backend`
```bash
> api-client-reborn@0.1.0 test:backend
> cargo test --manifest-path src-tauri/Cargo.toml

running 16 tests
test engine::grpc::tests::test_parse_grpcurl_args ... ok
test engine::grpc::tests::test_parse_grpcurl_args_multiline ... ok
test engine::stream::tests::test_sse_parser ... ok
test ipc::workspace_commands::tests::test_slugify ... ok
test parser::comment_meta::tests::test_extract_and_compose ... ok
test parser::curl::tests::test_parse_get ... ok
test parser::curl::tests::test_parse_grpcurl ... ok
test parser::curl::tests::test_parse_flags_and_auth ... ok
test parser::curl::tests::test_parse_post_with_inferred_method ... ok
test parser::lexer::tests::test_multiline_continuation ... ok
test parser::lexer::tests::test_quotes_and_escapes ... ok
test parser::lexer::tests::test_simple_curl ... ok
test ipc::workspace_commands::tests::test_rename_workspace_item_request ... ok
test env::resolver::tests::test_variable_resolution ... ok
test engine::spooler::tests::test_spooler_lifecycle ... ok
test fs::workspace::tests::test_scan_workspace ... ok

test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
Exit code: 0
```

### 4. Production Build: `npm run build`
```bash
> api-client-reborn@0.1.0 build
> vite build

vite v6.4.5 building for production...
✓ 174 modules transformed.
dist/index.html                   0.61 kB │ gzip:  0.39 kB
dist/assets/index-BYugTAsO.css   40.95 kB │ gzip:  6.97 kB
dist/assets/core-BnQpXQCV.js      1.69 kB │ gzip:  0.78 kB
dist/assets/index-CBLJ1SXa.js   232.79 kB │ gzip: 66.93 kB
✓ built in 1.43s
Exit code: 0
```
