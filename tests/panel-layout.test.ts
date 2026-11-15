import test from 'node:test';
import assert from 'node:assert/strict';
import {
  persistSidebarWidth,
  persistSplitRatio,
  readSidebarWidth,
  resetSidebarWidth,
  resetSplitRatio,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_STORAGE_KEY,
  SPLIT_RATIO_DEFAULT,
  SPLIT_RATIO_STORAGE_KEY,
} from '../src/lib/utils/panel-layout.ts';

function createStorage(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
} {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('sidebar width defaults safely and clamps stored values to its bounds', () => {
  const storage = createStorage();
  assert.equal(readSidebarWidth(storage), SIDEBAR_WIDTH_DEFAULT);
  storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, '160');
  assert.equal(readSidebarWidth(storage), SIDEBAR_WIDTH_MIN);
  storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, '500');
  assert.equal(readSidebarWidth(storage), SIDEBAR_WIDTH_MAX);
  storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, 'invalid');
  assert.equal(readSidebarWidth(storage), SIDEBAR_WIDTH_DEFAULT);
});

test('sidebar width persists clamped changes and double-click reset value', () => {
  const storage = createStorage();
  assert.equal(persistSidebarWidth(storage, 300.4), 300);
  assert.equal(readSidebarWidth(storage), 300);
  assert.equal(resetSidebarWidth(storage), SIDEBAR_WIDTH_DEFAULT);
  assert.equal(readSidebarWidth(storage), SIDEBAR_WIDTH_DEFAULT);
});

test('request and response split ratio persists clamped values and resets to 50/50', () => {
  const storage = createStorage();
  assert.equal(persistSplitRatio(storage, 0.8), 0.7);
  assert.equal(storage.getItem(SPLIT_RATIO_STORAGE_KEY), '0.7');
  assert.equal(resetSplitRatio(storage), SPLIT_RATIO_DEFAULT);
  assert.equal(storage.getItem(SPLIT_RATIO_STORAGE_KEY), '0.5');
});
