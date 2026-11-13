(globalThis as any).$state = (v: any) => v;

import test from 'node:test';
import assert from 'node:assert/strict';
import { relaunchApp } from '../src/lib/ipc.ts';

test('formatBytes formats byte counts correctly', async () => {
  const { formatBytes } = await import('../src/lib/state/updater.svelte.ts');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(-10), '0 B');
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1024 * 1024 * 14.5), '14.5 MB');
  assert.equal(formatBytes(1024 * 1024 * 1024 * 2.3), '2.3 GB');
});

test('UpdaterState initializes with default idle state and current version', async () => {
  const { UpdaterState, DEFAULT_APP_VERSION } = await import('../src/lib/state/updater.svelte.ts');
  const updater = new UpdaterState();
  assert.equal(updater.status, 'idle');
  assert.equal(updater.isModalOpen, false);
  assert.equal(updater.hasUpdateNotification, false);
  assert.equal(updater.downloadProgress, 0);
  assert.equal(updater.errorMessage, null);
  assert.equal(typeof updater.currentVersion, 'string');
  assert.equal(updater.currentVersion, DEFAULT_APP_VERSION);
  assert.match(updater.currentVersion, /^\d+\.\d+\.\d+/);

  const synced = await updater.syncCurrentVersion();
  assert.equal(synced, updater.currentVersion);
});

test('UpdaterState controls modal and notification visibility', async () => {
  const { UpdaterState } = await import('../src/lib/state/updater.svelte.ts');
  const updater = new UpdaterState();

  updater.openModal();
  assert.equal(updater.isModalOpen, true);

  updater.closeModal();
  assert.equal(updater.isModalOpen, false);

  updater.hasUpdateNotification = true;
  updater.dismissNotification();
  assert.equal(updater.hasUpdateNotification, false);
});

test('UpdaterState handles update checks in non-Tauri environment', async () => {
  const { UpdaterState } = await import('../src/lib/state/updater.svelte.ts');
  const updater = new UpdaterState();

  // Background check
  await updater.checkForUpdates({ manual: false });
  assert.equal(updater.status, 'up-to-date');
  assert.equal(updater.isModalOpen, false);

  // Manual check opens modal
  await updater.checkForUpdates({ manual: true });
  assert.equal(updater.status, 'up-to-date');
  assert.equal(updater.isModalOpen, true);
});

test('UpdaterState simulates download and install when update is available', async () => {
  const { UpdaterState } = await import('../src/lib/state/updater.svelte.ts');
  const updater = new UpdaterState();
  updater.status = 'available';
  updater.availableVersion = '0.9.1';

  await updater.downloadAndInstall();
  assert.equal(updater.status, 'downloaded');
  assert.equal(updater.downloadProgress, 100);
});

test('relaunchApp executes without throw in non-Tauri environment', async () => {
  await assert.doesNotReject(async () => {
    await relaunchApp();
  });
});
