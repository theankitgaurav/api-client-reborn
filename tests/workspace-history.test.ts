import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceOptions } from '../src/lib/utils/workspace-history.ts';

test('buildWorkspaceOptions pins the default first and removes duplicate paths', () => {
  assert.deepEqual(
    buildWorkspaceOptions('/default/workspace/', ['/recent/workspace', '/default/workspace', '/recent/workspace/', '/older']),
    ['/default/workspace/', '/recent/workspace', '/older'],
  );
});
