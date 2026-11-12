import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCommandItems, scoreCommand } from '../src/lib/utils/command-palette.ts';
import type { CommandPaletteItem } from '../src/lib/state/ui.svelte.ts';

function item(id: string, label: string, keywords: string[] = []): CommandPaletteItem {
  return { id, label, group: 'Actions', keywords, run: () => {} };
}

test('scoreCommand ranks label matches above keyword matches', () => {
  assert.ok(scoreCommand(item('send', 'Send request'), 'send') > scoreCommand(item('run', 'Run command', ['send']), 'send'));
  assert.equal(scoreCommand(item('save', 'Save request'), 'missing'), -1);
});

test('filterCommandItems supports multi-term matching and stable tie ordering', () => {
  const commands = [
    item('one', 'Open request', ['file']),
    item('two', 'Open tab', ['request']),
    item('three', 'Close tab'),
  ];
  assert.deepEqual(filterCommandItems(commands, 'open file').map((command) => command.id), ['one']);
  assert.deepEqual(filterCommandItems(commands, 'tab').map((command) => command.id), ['two', 'three']);
  assert.deepEqual(filterCommandItems(commands, '').map((command) => command.id), ['one', 'two', 'three']);
});
