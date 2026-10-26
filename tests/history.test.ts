import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendRequestHistory,
  clearRequestHistory,
  getRequestHistory,
} from '../src/lib/ipc.ts';
import type { RequestHistoryEntry } from '../src/lib/types.ts';

test('clearRequestHistory removes persisted entries from the frontend IPC store', async () => {
  const entry: RequestHistoryEntry = {
    id: 'clear-test-entry',
    timestamp: '2026-10-26T10:00:00.000Z',
    request_name: 'Clear Test',
    request_path: null,
    method: 'GET',
    url: 'https://example.com',
    raw_command: 'curl https://example.com',
    status: 200,
    status_text: 'OK',
    headers: [],
    response_body: '{}',
    duration_ms: 1,
    total_bytes: 2,
    is_streaming: false,
    error: null,
  };

  await appendRequestHistory('test-workspace', entry);
  assert.equal((await getRequestHistory('test-workspace')).length, 1);

  await clearRequestHistory('test-workspace');
  assert.deepEqual(await getRequestHistory('test-workspace'), []);
});
