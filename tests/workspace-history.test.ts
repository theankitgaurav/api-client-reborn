import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceOptions, getWorkspaceRevealLabel } from '../src/lib/utils/workspace-history.ts';

test('buildWorkspaceOptions pins the default first and removes duplicate paths', () => {
  assert.deepEqual(
    buildWorkspaceOptions('/default/workspace/', ['/recent/workspace', '/default/workspace', '/recent/workspace/', '/older']),
    ['/default/workspace/', '/recent/workspace', '/older'],
  );
});

test('workspace reveal labels use platform-specific Finder wording', () => {
  assert.equal(getWorkspaceRevealLabel(true), 'Reveal in Finder');
  assert.equal(getWorkspaceRevealLabel(false), 'Open in file explorer');
});

test('workspace menu exposes a hover and focus reveal action separately from switching', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/lib/components/Titlebar.svelte', import.meta.url), 'utf8');
  assert.match(source, /group-hover:opacity-100/);
  assert.match(source, /group-focus-within:opacity-100/);
  assert.match(source, /openWorkspaceInExplorer\(path\)/);
  assert.match(source, /revealWorkspaceFolder\(path\)/);
  assert.doesNotMatch(source, /@tauri-apps\/plugin-shell/);
  assert.match(source, /role="menuitem"[\s\S]*?onclick=\{\(\) => switchToWorkspace\(path\)\}/);
});
