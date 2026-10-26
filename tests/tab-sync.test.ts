import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cascadeFolderRename,
  filterTabsOnFolderDelete,
  openHistoryEntryInTabs,
  resolveTargetTabForOpenCurrent,
  formatDuplicateRequestName,
  sanitizeRequestRename,
  updateRequestNameHeader,
  normalizeFolderPath,
  type TabItem,
} from '../src/lib/utils/workspace-sync.ts';
import type { RequestHistoryEntry } from '../src/lib/types.ts';

const historyEntry: RequestHistoryEntry = {
  id: 'history-1',
  timestamp: '2026-10-26T10:00:00.000Z',
  request_name: 'Saved Request',
  request_path: 'api/saved.curl',
  method: 'POST',
  url: 'https://api.example.com/saved',
  raw_command: 'curl -X POST https://api.example.com/saved -d \'{"ok":true}\'',
  status: 201,
  status_text: 'Created',
  headers: [{ key: 'content-type', value: 'application/json' }],
  response_body: '{"created":true}',
  duration_ms: 42,
  total_bytes: 16,
  is_streaming: false,
  error: null,
};

// Helper to construct sample TabItem for tests
function makeTab(overrides: Partial<TabItem> = {}): TabItem {
  return {
    id: overrides.id || `tab-${Math.random().toString(36).substring(2, 9)}`,
    filePath: overrides.filePath !== undefined ? overrides.filePath : 'collections/users/get.curl',
    name: overrides.name || 'Get Users',
    method: overrides.method || 'GET',
    rawContent: overrides.rawContent || '# @name Get Users\ncurl https://api.example.com/users',
    isDirty: overrides.isDirty ?? false,
    isPinned: overrides.isPinned ?? false,
    sidecar: overrides.sidecar,
    response: overrides.response,
  };
}

// ============================================================================
// 1. cascadeFolderRename — Tier 1: Feature Coverage (5+ tests)
// ============================================================================

test('cascadeFolderRename (Tier 1) updates child tab filePath when folder is renamed', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'collections/users/list.curl' }),
  ];
  const updated = cascadeFolderRename(tabs, 'collections/users', 'collections/accounts');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].filePath, 'collections/accounts/list.curl');
});

test('cascadeFolderRename (Tier 1) cascades to deeply nested descendant tabs', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'api/v1/auth/tokens/refresh.curl' }),
    makeTab({ id: '2', filePath: 'api/v1/auth/oauth/callback.curl' }),
  ];
  const updated = cascadeFolderRename(tabs, 'api/v1', 'api/v2');
  assert.equal(updated[0].filePath, 'api/v2/auth/tokens/refresh.curl');
  assert.equal(updated[1].filePath, 'api/v2/auth/oauth/callback.curl');
});

test('cascadeFolderRename (Tier 1) leaves unrelated tabs completely untouched', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'collections/users/list.curl' }),
    makeTab({ id: '2', filePath: 'collections/billing/invoice.curl' }),
  ];
  const updated = cascadeFolderRename(tabs, 'collections/users', 'collections/accounts');
  assert.equal(updated[0].filePath, 'collections/accounts/list.curl');
  assert.equal(updated[1].filePath, 'collections/billing/invoice.curl');
});

test('cascadeFolderRename (Tier 1) does not touch sibling folders sharing common prefix', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'api/auth/login.curl' }),
    makeTab({ id: '2', filePath: 'api/auth-helpers/util.curl' }),
    makeTab({ id: '3', filePath: 'api/authentication/sso.curl' }),
  ];
  const updated = cascadeFolderRename(tabs, 'api/auth', 'api/security');
  assert.equal(updated[0].filePath, 'api/security/login.curl');
  assert.equal(updated[1].filePath, 'api/auth-helpers/util.curl', 'sibling auth-helpers must not be renamed');
  assert.equal(updated[2].filePath, 'api/authentication/sso.curl', 'sibling authentication must not be renamed');
});

test('cascadeFolderRename (Tier 1) preserves draft tabs with null filePath', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: null, name: 'Untitled Request' }),
    makeTab({ id: '2', filePath: 'users/profile.curl' }),
  ];
  const updated = cascadeFolderRename(tabs, 'users', 'members');
  assert.equal(updated[0].filePath, null);
  assert.equal(updated[0].name, 'Untitled Request');
  assert.equal(updated[1].filePath, 'members/profile.curl');
});

// ============================================================================
// 1. cascadeFolderRename — Tier 2: Boundary & Corner Cases (5+ tests)
// ============================================================================

test('cascadeFolderRename (Tier 2) strips trailing slashes on oldPath and newPath', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'collections/v1/req.curl' }),
  ];
  const updated = cascadeFolderRename(tabs, 'collections/v1///', 'collections/v2///');
  assert.equal(updated[0].filePath, 'collections/v2/req.curl');
});

test('cascadeFolderRename (Tier 2) updates exact path match without trailing slash', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'collections/target' }),
  ];
  const updated = cascadeFolderRename(tabs, 'collections/target', 'collections/destination');
  assert.equal(updated[0].filePath, 'collections/destination');
});

test('cascadeFolderRename (Tier 2) preserves all metadata, response data, and dirty/pinned flags', () => {
  const original = makeTab({
    id: 'tab-meta',
    filePath: 'v1/get.curl',
    isDirty: true,
    isPinned: true,
    method: 'POST',
    rawContent: '# custom content',
    sidecar: { tests: [{ test_type: 'status_code', expected: 200 }] },
    response: {
      status: 200,
      statusText: 'OK',
      protocol: 'HTTP/1.1',
      ttfbMs: 12,
      durationMs: 45,
      totalBytes: 1024,
      headers: [{ key: 'content-type', value: 'application/json' }],
      bodyText: '{"ok":true}',
      streamMessages: [],
      error: null,
      activeTab: 'body',
      testResults: [],
      scriptLogs: [],
    },
  });
  const updated = cascadeFolderRename([original], 'v1', 'v2');
  assert.equal(updated[0].filePath, 'v2/get.curl');
  assert.equal(updated[0].isDirty, true);
  assert.equal(updated[0].isPinned, true);
  assert.equal(updated[0].method, 'POST');
  assert.equal(updated[0].rawContent, '# custom content');
  assert.deepEqual(updated[0].sidecar, original.sidecar);
  assert.deepEqual(updated[0].response, original.response);
});

test('cascadeFolderRename (Tier 2) handles root folder rename gracefully', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'root_dir/sub/item.curl' }),
  ];
  const updated = cascadeFolderRename(tabs, 'root_dir', 'new_root');
  assert.equal(updated[0].filePath, 'new_root/sub/item.curl');
});

test('cascadeFolderRename (Tier 2) handles special characters, spaces, and hyphens in folder paths', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'My Collections [v1.0]/special & char/test.curl' }),
  ];
  const updated = cascadeFolderRename(
    tabs,
    'My Collections [v1.0]/special & char',
    'My Collections [v1.0]/renamed (new)'
  );
  assert.equal(updated[0].filePath, 'My Collections [v1.0]/renamed (new)/test.curl');
});

test('cascadeFolderRename (Tier 2) returns unmodified array when oldPath is empty or root dot', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'users/list.curl' }),
  ];
  const updated1 = cascadeFolderRename(tabs, '', 'target');
  assert.equal(updated1[0].filePath, 'users/list.curl');

  const updated2 = cascadeFolderRename(tabs, '///', 'target');
  assert.equal(updated2[0].filePath, 'users/list.curl');
});

// ============================================================================
// 2. filterTabsOnFolderDelete — Tier 1: Feature Coverage (5+ tests)
// ============================================================================

test('filterTabsOnFolderDelete (Tier 1) closes direct child request tabs in deleted folder', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'collections/auth/login.curl' }),
    makeTab({ id: '2', filePath: 'collections/auth/logout.curl' }),
  ];
  const { remainingTabs, closedTabs } = filterTabsOnFolderDelete(tabs, 'collections/auth');
  assert.equal(closedTabs.length, 2);
  assert.equal(remainingTabs.length, 0);
  assert.equal(closedTabs[0].id, '1');
  assert.equal(closedTabs[1].id, '2');
});

test('filterTabsOnFolderDelete (Tier 1) closes nested subfolder child tabs', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'api/v1/auth/tokens/jwt.curl' }),
    makeTab({ id: '2', filePath: 'api/v1/users/profile.curl' }),
  ];
  const { remainingTabs, closedTabs } = filterTabsOnFolderDelete(tabs, 'api/v1');
  assert.equal(closedTabs.length, 2);
  assert.equal(remainingTabs.length, 0);
});

test('filterTabsOnFolderDelete (Tier 1) keeps tabs outside the deleted folder', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'api/v1/auth/login.curl' }),
    makeTab({ id: '2', filePath: 'api/v2/auth/login.curl' }),
    makeTab({ id: '3', filePath: 'health.curl' }),
  ];
  const { remainingTabs, closedTabs } = filterTabsOnFolderDelete(tabs, 'api/v1/auth');
  assert.equal(closedTabs.length, 1);
  assert.equal(closedTabs[0].id, '1');
  assert.equal(remainingTabs.length, 2);
  assert.equal(remainingTabs[0].id, '2');
  assert.equal(remainingTabs[1].id, '3');
});

test('filterTabsOnFolderDelete (Tier 1) preserves draft tabs with null filePath', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: null, name: 'Untitled Request' }),
    makeTab({ id: '2', filePath: 'folder/req.curl' }),
  ];
  const { remainingTabs, closedTabs } = filterTabsOnFolderDelete(tabs, 'folder');
  assert.equal(closedTabs.length, 1);
  assert.equal(remainingTabs.length, 1);
  assert.equal(remainingTabs[0].filePath, null);
});

test('filterTabsOnFolderDelete (Tier 1) handles empty tabs list', () => {
  const { remainingTabs, closedTabs } = filterTabsOnFolderDelete([], 'folder');
  assert.equal(remainingTabs.length, 0);
  assert.equal(closedTabs.length, 0);
});

// ============================================================================
// 2. filterTabsOnFolderDelete — Tier 2: Boundary & Corner Cases (5+ tests)
// ============================================================================

test('filterTabsOnFolderDelete (Tier 2) strictly prevents false prefix matches on sibling folders', () => {
  const tabs: TabItem[] = [
    makeTab({ id: 'target', filePath: 'collections/auth/login.curl' }),
    makeTab({ id: 'sibling-1', filePath: 'collections/auth-helpers/jwt.curl' }),
    makeTab({ id: 'sibling-2', filePath: 'collections/auth_backup/old.curl' }),
    makeTab({ id: 'sibling-3', filePath: 'collections/authentication/sso.curl' }),
  ];
  const { remainingTabs, closedTabs } = filterTabsOnFolderDelete(tabs, 'collections/auth');
  assert.equal(closedTabs.length, 1);
  assert.equal(closedTabs[0].id, 'target');
  assert.equal(remainingTabs.length, 3);
  assert.ok(remainingTabs.some((t) => t.id === 'sibling-1'));
  assert.ok(remainingTabs.some((t) => t.id === 'sibling-2'));
  assert.ok(remainingTabs.some((t) => t.id === 'sibling-3'));
});

test('filterTabsOnFolderDelete (Tier 2) normalizes trailing slashes on deletedFolderPath', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'collections/users/list.curl' }),
    makeTab({ id: '2', filePath: 'collections/users_v2/list.curl' }),
  ];
  const { remainingTabs, closedTabs } = filterTabsOnFolderDelete(tabs, 'collections/users///');
  assert.equal(closedTabs.length, 1);
  assert.equal(closedTabs[0].id, '1');
  assert.equal(remainingTabs.length, 1);
  assert.equal(remainingTabs[0].id, '2');
});

test('filterTabsOnFolderDelete (Tier 2) closes tab if filePath exactly equals deletedFolderPath', () => {
  const tabs: TabItem[] = [
    makeTab({ id: 'exact', filePath: 'collections/target' }),
    makeTab({ id: 'child', filePath: 'collections/target/child.curl' }),
    makeTab({ id: 'other', filePath: 'collections/other/child.curl' }),
  ];
  const { remainingTabs, closedTabs } = filterTabsOnFolderDelete(tabs, 'collections/target');
  assert.equal(closedTabs.length, 2);
  assert.equal(remainingTabs.length, 1);
  assert.equal(remainingTabs[0].id, 'other');
});

test('filterTabsOnFolderDelete (Tier 2) returns all tabs in remaining if deletedFolderPath is empty', () => {
  const tabs: TabItem[] = [
    makeTab({ id: '1', filePath: 'a/b.curl' }),
    makeTab({ id: '2', filePath: 'c/d.curl' }),
  ];
  const { remainingTabs, closedTabs } = filterTabsOnFolderDelete(tabs, '');
  assert.equal(remainingTabs.length, 2);
  assert.equal(closedTabs.length, 0);
});

test('filterTabsOnFolderDelete (Tier 2) handles numeric and hyphenated folder prefixes safely (/v1 vs /v10)', () => {
  const tabs: TabItem[] = [
    makeTab({ id: 'v1-req', filePath: 'api/v1/test.curl' }),
    makeTab({ id: 'v10-req', filePath: 'api/v10/test.curl' }),
    makeTab({ id: 'v100-req', filePath: 'api/v100/test.curl' }),
    makeTab({ id: 'v1-beta-req', filePath: 'api/v1-beta/test.curl' }),
  ];
  const { remainingTabs, closedTabs } = filterTabsOnFolderDelete(tabs, 'api/v1');
  assert.equal(closedTabs.length, 1);
  assert.equal(closedTabs[0].id, 'v1-req');
  assert.equal(remainingTabs.length, 3);
  assert.ok(remainingTabs.some((t) => t.id === 'v10-req'));
  assert.ok(remainingTabs.some((t) => t.id === 'v100-req'));
  assert.ok(remainingTabs.some((t) => t.id === 'v1-beta-req'));
});

// ============================================================================
// 3. resolveTargetTabForOpenCurrent — Tier 1: Feature Coverage (5+ tests)
// ============================================================================

test('resolveTargetTabForOpenCurrent (Tier 1) replaces active tab when clean and unpinned', () => {
  const activeTab = makeTab({ id: 'active', isDirty: false, isPinned: false });
  const tabs: TabItem[] = [activeTab];
  const result = resolveTargetTabForOpenCurrent(tabs, 'active');
  assert.equal(result.shouldAppend, false);
  assert.equal(result.tabToReplace?.id, 'active');
});

test('resolveTargetTabForOpenCurrent (Tier 1) does not replace active tab if dirty', () => {
  const activeTab = makeTab({ id: 'active', isDirty: true, isPinned: false });
  const tabs: TabItem[] = [activeTab];
  const result = resolveTargetTabForOpenCurrent(tabs, 'active');
  assert.equal(result.shouldAppend, true);
  assert.equal(result.tabToReplace, null);
});

test('resolveTargetTabForOpenCurrent (Tier 1) does not replace active tab if pinned', () => {
  const activeTab = makeTab({ id: 'active', isDirty: false, isPinned: true });
  const tabs: TabItem[] = [activeTab];
  const result = resolveTargetTabForOpenCurrent(tabs, 'active');
  assert.equal(result.shouldAppend, true);
  assert.equal(result.tabToReplace, null);
});

test('resolveTargetTabForOpenCurrent (Tier 1) falls back to another clean preview tab when active tab is pinned', () => {
  const activeTab = makeTab({ id: 'active-pinned', isDirty: false, isPinned: true });
  const previewTab = makeTab({ id: 'other-preview', isDirty: false, isPinned: false });
  const tabs: TabItem[] = [activeTab, previewTab];
  const result = resolveTargetTabForOpenCurrent(tabs, 'active-pinned');
  assert.equal(result.shouldAppend, false);
  assert.equal(result.tabToReplace?.id, 'other-preview');
});

test('resolveTargetTabForOpenCurrent (Tier 1) appends when all tabs are pinned or dirty', () => {
  const tab1 = makeTab({ id: 't1', isDirty: true, isPinned: false });
  const tab2 = makeTab({ id: 't2', isDirty: false, isPinned: true });
  const tab3 = makeTab({ id: 't3', isDirty: true, isPinned: true });
  const tabs: TabItem[] = [tab1, tab2, tab3];
  const result = resolveTargetTabForOpenCurrent(tabs, 't2');
  assert.equal(result.shouldAppend, true);
  assert.equal(result.tabToReplace, null);
});

// ============================================================================
// 3. resolveTargetTabForOpenCurrent — Tier 2: Boundary & Corner Cases (5+ tests)
// ============================================================================

test('resolveTargetTabForOpenCurrent (Tier 2) prioritizes active tab at index 2 over preview tab at index 0', () => {
  const tab0 = makeTab({ id: 'tab-0', isDirty: false, isPinned: false, filePath: 'file0.curl' });
  const tab1 = makeTab({ id: 'tab-1', isDirty: false, isPinned: true, filePath: 'file1.curl' });
  const tab2 = makeTab({ id: 'tab-2', isDirty: false, isPinned: false, filePath: 'file2.curl' });
  const tabs: TabItem[] = [tab0, tab1, tab2];

  // User is currently focused on tab-2 (which is clean preview)
  const result = resolveTargetTabForOpenCurrent(tabs, 'tab-2');
  assert.equal(result.shouldAppend, false);
  assert.equal(
    result.tabToReplace?.id,
    'tab-2',
    'Must replace currently active tab (tab-2), NOT tab-0 from index 0!'
  );
});

test('resolveTargetTabForOpenCurrent (Tier 2) handles empty tabs array', () => {
  const result = resolveTargetTabForOpenCurrent([], null);
  assert.equal(result.shouldAppend, true);
  assert.equal(result.tabToReplace, null);
});

test('resolveTargetTabForOpenCurrent (Tier 2) handles null activeTabId with clean preview tab present', () => {
  const previewTab = makeTab({ id: 'preview', isDirty: false, isPinned: false });
  const pinnedTab = makeTab({ id: 'pinned', isDirty: false, isPinned: true });
  const result = resolveTargetTabForOpenCurrent([pinnedTab, previewTab], null);
  assert.equal(result.shouldAppend, false);
  assert.equal(result.tabToReplace?.id, 'preview');
});

test('resolveTargetTabForOpenCurrent (Tier 2) handles activeTabId not found in tabs array', () => {
  const previewTab = makeTab({ id: 'preview', isDirty: false, isPinned: false });
  const result = resolveTargetTabForOpenCurrent([previewTab], 'non-existent-id');
  assert.equal(result.shouldAppend, false);
  assert.equal(result.tabToReplace?.id, 'preview');
});

test('resolveTargetTabForOpenCurrent (Tier 2) allows replacing an untitled clean draft tab', () => {
  const draftTab = makeTab({ id: 'draft', filePath: null, name: 'Untitled Request', isDirty: false, isPinned: false });
  const result = resolveTargetTabForOpenCurrent([draftTab], 'draft');
  assert.equal(result.shouldAppend, false);
  assert.equal(result.tabToReplace?.id, 'draft');
});

test('openHistoryEntryInTabs loads request and response data into a preview tab', () => {
  const result = openHistoryEntryInTabs([], null, historyEntry, 'history-tab');
  assert.equal(result.activeTabId, 'history-tab');
  assert.equal(result.tabs.length, 1);
  assert.equal(result.openedTab.filePath, null);
  assert.equal(result.openedTab.name, historyEntry.request_name);
  assert.equal(result.openedTab.method, historyEntry.method);
  assert.equal(result.openedTab.rawContent, historyEntry.raw_command);
  assert.deepEqual(result.openedTab.response, {
    status: 201,
    statusText: 'Created',
    protocol: '',
    ttfbMs: null,
    durationMs: 42,
    totalBytes: 16,
    headers: historyEntry.headers,
    bodyText: historyEntry.response_body,
    streamMessages: [],
    isStreaming: false,
    error: null,
    activeTab: 'body',
    testResults: [],
    scriptLogs: [],
    isBodyTruncated: false,
    totalEventsCount: 0,
    spoolFilePath: null,
  });
});

test('openHistoryEntryInTabs reuses a clean preview and preserves pinned or dirty tabs', () => {
  const pinned = makeTab({ id: 'pinned', isPinned: true });
  const dirty = makeTab({ id: 'dirty', isDirty: true });
  const preview = makeTab({ id: 'preview', filePath: null, isPinned: false });
  const result = openHistoryEntryInTabs([pinned, dirty, preview], 'pinned', historyEntry, 'new');

  assert.equal(result.tabs.length, 3);
  assert.equal(result.activeTabId, 'new');
  assert.equal(result.tabs[0], pinned);
  assert.equal(result.tabs[1], dirty);
  assert.equal(result.tabs[2].id, 'new');
  assert.equal(result.tabs[2].rawContent, historyEntry.raw_command);
});

test('openHistoryEntryInTabs appends when all existing tabs are pinned or dirty', () => {
  const pinned = makeTab({ id: 'pinned', isPinned: true });
  const dirty = makeTab({ id: 'dirty', isDirty: true });
  const result = openHistoryEntryInTabs([pinned, dirty], 'pinned', historyEntry, 'history-tab');

  assert.equal(result.tabs.length, 3);
  assert.equal(result.tabs[0], pinned);
  assert.equal(result.tabs[1], dirty);
  assert.equal(result.activeTabId, 'history-tab');
});

// ============================================================================
// 4. formatDuplicateRequestName — Tier 1: Feature Coverage (5+ tests)
// ============================================================================

test('formatDuplicateRequestName (Tier 1) produces stem_copy.curl on initial duplicate', () => {
  const name = formatDuplicateRequestName('get_user', []);
  assert.equal(name, 'get_user_copy.curl');
});

test('formatDuplicateRequestName (Tier 1) increments to _copy_2 when _copy exists', () => {
  const name = formatDuplicateRequestName('get_user', ['get_user_copy.curl']);
  assert.equal(name, 'get_user_copy_2.curl');
});

test('formatDuplicateRequestName (Tier 1) defaults extension to curl when omitted', () => {
  const name = formatDuplicateRequestName('query', []);
  assert.equal(name, 'query_copy.curl');
});

test('formatDuplicateRequestName (Tier 1) detects collision against full paths in existingNames', () => {
  const existing = ['collections/auth/login_copy.curl'];
  const name = formatDuplicateRequestName('login', existing);
  assert.equal(name, 'login_copy_2.curl');
});

// ============================================================================
// 4. formatDuplicateRequestName — Tier 2: Boundary & Corner Cases (5+ tests)
// ============================================================================

test('formatDuplicateRequestName (Tier 2) fills gaps or increments past multiple copies', () => {
  const existing = [
    'get_user_copy.curl',
    'get_user_copy_2.curl',
    'get_user_copy_3.curl',
  ];
  const name = formatDuplicateRequestName('get_user', existing);
  assert.equal(name, 'get_user_copy_4.curl');
});

test('formatDuplicateRequestName (Tier 2) strips existing .curl extension from stem before appending copy', () => {
  const name = formatDuplicateRequestName('profile.curl', []);
  assert.equal(name, 'profile_copy.curl');
  assert.ok(!name.includes('.curl.curl'));
});

test('formatDuplicateRequestName (Tier 2) handles stem containing dots, hyphens, and spaces', () => {
  const name = formatDuplicateRequestName('api-v1.0.users detail', []);
  assert.equal(name, 'api-v1.0.users detail_copy.curl');
});

test('formatDuplicateRequestName (Tier 2) handles high duplicate count without infinite loop', () => {
  const existing = Array.from({ length: 20 }, (_, i) =>
    i === 0 ? 'request_copy.curl' : `request_copy_${i + 1}.curl`
  );
  const name = formatDuplicateRequestName('request', existing);
  assert.equal(name, 'request_copy_21.curl');
});

// ============================================================================
// 5. sanitizeRequestRename — Tier 1: Feature Coverage (5+ tests)
// ============================================================================

test('sanitizeRequestRename (Tier 1) appends .curl if extension is omitted by user', () => {
  const sanitized = sanitizeRequestRename('collections/auth/login.curl', 'Sign In');
  assert.equal(sanitized, 'Sign In.curl');
});

test('sanitizeRequestRename (Tier 1) keeps explicit typed .curl extension without duplicating', () => {
  const sanitized = sanitizeRequestRename('collections/test.curl', 'new_test.curl');
  assert.equal(sanitized, 'new_test.curl');
});

test('sanitizeRequestRename (Tier 1) sanitizes directory slashes to prevent path traversal', () => {
  const sanitized = sanitizeRequestRename('items/get.curl', '../../evil/name');
  assert.equal(sanitized, '.._.._evil_name.curl');
  assert.ok(!sanitized.includes('/'));
  assert.ok(!sanitized.includes('\\'));
});

// ============================================================================
// 5. sanitizeRequestRename — Tier 2: Boundary & Corner Cases (5+ tests)
// ============================================================================

test('sanitizeRequestRename (Tier 2) enforces .curl when user types mismatched extension (e.g. .json)', () => {
  const sanitized = sanitizeRequestRename('request.curl', 'payload.json');
  assert.equal(sanitized, 'payload.json.curl');
});

test('sanitizeRequestRename (Tier 2) falls back to current file stem when user enters empty/whitespace name', () => {
  const sanitized1 = sanitizeRequestRename('collections/auth/login.curl', '   ');
  assert.equal(sanitized1, 'login.curl');
});

test('sanitizeRequestRename (Tier 2) trims leading and trailing whitespace', () => {
  const sanitized = sanitizeRequestRename('query.curl', '   My Query   ');
  assert.equal(sanitized, 'My Query.curl');
});

test('sanitizeRequestRename (Tier 2) handles case-insensitive typed extensions (.CURL)', () => {
  const sanitized1 = sanitizeRequestRename('query.curl', 'fetch_data.CURL');
  assert.equal(sanitized1, 'fetch_data.curl');
});

test('sanitizeRequestRename (Tier 2) handles custom multi-part extensions properly', () => {
  const sanitized = sanitizeRequestRename('sample.test.curl', 'renamed');
  assert.equal(sanitized, 'renamed.curl');
});

// ============================================================================
// 6. updateRequestNameHeader — Tier 1: Feature Coverage (5+ tests)
// ============================================================================

test('updateRequestNameHeader (Tier 1) replaces existing # @name header', () => {
  const input = '# @name Old Name\n# @timeout 5000\ncurl https://api.example.com';
  const output = updateRequestNameHeader(input, 'New Display Name');
  assert.ok(output.includes('# @name New Display Name'));
  assert.ok(!output.includes('Old Name'));
  assert.ok(output.includes('# @timeout 5000'));
});

test('updateRequestNameHeader (Tier 1) prepends header when none exists in content', () => {
  const input = 'curl -X GET "https://api.example.com/users"';
  const output = updateRequestNameHeader(input, 'Get Users');
  assert.equal(output, '# @name Get Users\ncurl -X GET "https://api.example.com/users"');
});

test('updateRequestNameHeader (Tier 1) handles arbitrary whitespace in existing header (#   @name)', () => {
  const input = '#   @name    Spaced Name  \ncurl https://api.example.com';
  const output = updateRequestNameHeader(input, 'Clean Name');
  assert.ok(output.startsWith('# @name Clean Name\n'));
  assert.ok(!output.includes('Spaced Name'));
});

test('updateRequestNameHeader (Tier 1) handles # @name located after initial comments', () => {
  const input = '# Description: This is a test\n# @name Old Target\ncurl https://api.example.com';
  const output = updateRequestNameHeader(input, 'New Target');
  assert.equal(
    output,
    '# Description: This is a test\n# @name New Target\ncurl https://api.example.com'
  );
});

test('updateRequestNameHeader (Tier 1) produces header on empty content', () => {
  const output = updateRequestNameHeader('', 'New Request');
  assert.equal(output, '# @name New Request\n');
});

// ============================================================================
// 6. updateRequestNameHeader — Tier 2: Boundary & Corner Cases (5+ tests)
// ============================================================================

test('updateRequestNameHeader (Tier 2) does not replace @name inside JSON body or string literals', () => {
  const input = `curl -X POST "https://api.example.com" \\
  -d '{"@name": "not-a-header", "user": "alice"}'`;
  const output = updateRequestNameHeader(input, 'Created User');
  assert.ok(output.startsWith('# @name Created User\n'));
  assert.ok(output.includes('"@name": "not-a-header"'), 'JSON body @name must not be modified');
});

test('updateRequestNameHeader (Tier 2) preserves CRLF line endings when present', () => {
  const input = '# @name Old\r\n# @timeout 1000\r\ncurl https://example.com';
  const output = updateRequestNameHeader(input, 'New');
  assert.ok(output.includes('# @name New'));
  assert.ok(output.includes('# @timeout 1000'));
});

test('updateRequestNameHeader (Tier 2) handles Unicode and special characters in display name', () => {
  const input = 'curl https://api.example.com';
  const output = updateRequestNameHeader(input, '🚀 Login & Auth (v2.0) [Staging]');
  assert.ok(output.startsWith('# @name 🚀 Login & Auth (v2.0) [Staging]\n'));
});

test('updateRequestNameHeader (Tier 2) handles whitespace-only content by replacing with header', () => {
  const output = updateRequestNameHeader('   \n\t  \n', 'Fresh Name');
  assert.equal(output, '# @name Fresh Name\n');
});

test('updateRequestNameHeader (Tier 2) handles header with no existing name value (# @name)', () => {
  const input = '# @name\ncurl https://api.example.com';
  const output = updateRequestNameHeader(input, 'Given Name');
  assert.equal(output, '# @name Given Name\ncurl https://api.example.com');
});

// ============================================================================
// normalizeFolderPath utility tests
// ============================================================================

test('normalizeFolderPath strips trailing slashes and handles dots', () => {
  assert.equal(normalizeFolderPath('collections/auth///'), 'collections/auth');
  assert.equal(normalizeFolderPath('collections/auth/'), 'collections/auth');
  assert.equal(normalizeFolderPath('.'), '.');
  assert.equal(normalizeFolderPath(''), '.');
});
