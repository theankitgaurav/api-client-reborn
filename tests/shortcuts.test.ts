import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHORTCUT_DEFINITIONS,
  resolveShortcut,
  executeShortcut,
  type KeyboardEventLike,
  type ShortcutContext,
} from '../src/lib/utils/shortcuts.ts';

function createEvent(overrides: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
  let defaultPrevented = false;
  return {
    key: '',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: () => {
      defaultPrevented = true;
    },
    ...overrides,
  };
}

function createMockContext(overrides: Partial<ShortcutContext> = {}): {
  context: ShortcutContext;
  calls: Record<string, any[]>;
} {
  const calls: Record<string, any[]> = {};
  const record = (name: string) => (...args: any[]) => {
    if (!calls[name]) calls[name] = [];
    calls[name].push(args);
  };

  const context: ShortcutContext = {
    createNewRequest: record('createNewRequest'),
    closeActiveTab: record('closeActiveTab'),
    closeOtherTabs: record('closeOtherTabs'),
    nextTab: record('nextTab'),
    previousTab: record('previousTab'),
    selectTabByIndex: record('selectTabByIndex'),
    selectLastTab: record('selectLastTab'),
    saveActiveFile: record('saveActiveFile'),
    handleSend: record('handleSend'),
    beautifyJson: record('beautifyJson'),
    focusUrlInput: record('focusUrlInput'),
    focusFilterInput: record('focusFilterInput'),
    toggleVariablesModal: record('toggleVariablesModal'),
    closeActiveModal: () => {
      record('closeActiveModal')();
      return true;
    },
    toggleCheatSheet: record('toggleCheatSheet'),
    ...overrides,
  };

  return { context, calls };
}

test('SHORTCUT_DEFINITIONS contains complete and valid metadata', () => {
  assert.ok(SHORTCUT_DEFINITIONS.length >= 10);
  for (const s of SHORTCUT_DEFINITIONS) {
    assert.ok(s.id, 'Shortcut must have an id');
    assert.ok(s.label, 'Shortcut must have a label');
    assert.ok(s.description, 'Shortcut must have a description');
    assert.ok(s.macKeys.length > 0, 'Shortcut must have macKeys');
    assert.ok(s.winKeys.length > 0, 'Shortcut must have winKeys');
  }
});

test('resolveShortcut: Cmd+N and Ctrl+N resolve to new-request', () => {
  // macOS: Cmd+N
  let resolved = resolveShortcut(createEvent({ metaKey: true, key: 'n' }));
  assert.deepEqual(resolved, { type: 'new-request' });

  // Windows/Linux: Ctrl+N
  resolved = resolveShortcut(createEvent({ ctrlKey: true, key: 'n' }));
  assert.deepEqual(resolved, { type: 'new-request' });

  // Uppercase N
  resolved = resolveShortcut(createEvent({ metaKey: true, key: 'N' }));
  assert.deepEqual(resolved, { type: 'new-request' });

  // Plain 'n' key without modifier must not match
  resolved = resolveShortcut(createEvent({ key: 'n' }));
  assert.equal(resolved, null);
});

test('resolveShortcut: Cmd+W and Ctrl+W resolve to close-tab, Cmd+Option+W to close-other-tabs', () => {
  // Cmd+W
  let resolved = resolveShortcut(createEvent({ metaKey: true, key: 'w' }));
  assert.deepEqual(resolved, { type: 'close-tab' });

  // Ctrl+W
  resolved = resolveShortcut(createEvent({ ctrlKey: true, key: 'w' }));
  assert.deepEqual(resolved, { type: 'close-tab' });

  // Cmd+Option+W
  resolved = resolveShortcut(createEvent({ metaKey: true, altKey: true, key: 'w' }));
  assert.deepEqual(resolved, { type: 'close-other-tabs' });

  // Plain 'w' key must not match
  resolved = resolveShortcut(createEvent({ key: 'w' }));
  assert.equal(resolved, null);
});

test('resolveShortcut: Tab navigation shortcuts', () => {
  // Next Tab: Ctrl+Tab
  let resolved = resolveShortcut(createEvent({ ctrlKey: true, key: 'Tab' }));
  assert.deepEqual(resolved, { type: 'next-tab' });

  // Next Tab: Cmd+Option+ArrowRight
  resolved = resolveShortcut(createEvent({ metaKey: true, altKey: true, key: 'ArrowRight' }));
  assert.deepEqual(resolved, { type: 'next-tab' });

  // Next Tab: Cmd+Shift+]
  resolved = resolveShortcut(createEvent({ metaKey: true, shiftKey: true, key: ']' }));
  assert.deepEqual(resolved, { type: 'next-tab' });

  // Previous Tab: Ctrl+Shift+Tab
  resolved = resolveShortcut(createEvent({ ctrlKey: true, shiftKey: true, key: 'Tab' }));
  assert.deepEqual(resolved, { type: 'previous-tab' });

  // Previous Tab: Cmd+Option+ArrowLeft
  resolved = resolveShortcut(createEvent({ metaKey: true, altKey: true, key: 'ArrowLeft' }));
  assert.deepEqual(resolved, { type: 'previous-tab' });

  // Previous Tab: Cmd+Shift+[
  resolved = resolveShortcut(createEvent({ metaKey: true, shiftKey: true, key: '[' }));
  assert.deepEqual(resolved, { type: 'previous-tab' });
});

test('resolveShortcut: Numbered tab switching Cmd+1..8 and Cmd+9', () => {
  assert.deepEqual(resolveShortcut(createEvent({ metaKey: true, key: '1' })), {
    type: 'select-tab',
    tabIndex: 0,
  });

  assert.deepEqual(resolveShortcut(createEvent({ ctrlKey: true, key: '3' })), {
    type: 'select-tab',
    tabIndex: 2,
  });

  assert.deepEqual(resolveShortcut(createEvent({ metaKey: true, key: '8' })), {
    type: 'select-tab',
    tabIndex: 7,
  });

  assert.deepEqual(resolveShortcut(createEvent({ metaKey: true, key: '9' })), {
    type: 'last-tab',
  });
});

test('resolveShortcut: Request execution and saving (Cmd+Enter, Cmd+S, Cmd+Option+B)', () => {
  assert.deepEqual(resolveShortcut(createEvent({ metaKey: true, key: 'Enter' })), {
    type: 'send-request',
  });

  assert.deepEqual(resolveShortcut(createEvent({ ctrlKey: true, key: 'Enter' })), {
    type: 'send-request',
  });

  assert.deepEqual(resolveShortcut(createEvent({ metaKey: true, key: 's' })), {
    type: 'save-request',
  });

  assert.deepEqual(resolveShortcut(createEvent({ metaKey: true, altKey: true, key: 'b' })), {
    type: 'beautify-json',
  });
});

test('resolveShortcut: Navigation shortcuts (Cmd+L, Cmd+F, Cmd+P, Cmd+E)', () => {
  assert.deepEqual(resolveShortcut(createEvent({ metaKey: true, key: 'l' })), {
    type: 'focus-url',
  });

  assert.deepEqual(resolveShortcut(createEvent({ ctrlKey: true, key: 'f' })), {
    type: 'focus-filter',
  });

  assert.deepEqual(resolveShortcut(createEvent({ metaKey: true, key: 'p' })), {
    type: 'focus-filter',
  });

  assert.deepEqual(resolveShortcut(createEvent({ metaKey: true, key: 'e' })), {
    type: 'toggle-variables',
  });
});

test('resolveShortcut: General and help shortcuts (Escape, Cmd+/, ?)', () => {
  assert.deepEqual(resolveShortcut(createEvent({ key: 'Escape' })), {
    type: 'close-modal',
  });

  assert.deepEqual(resolveShortcut(createEvent({ metaKey: true, key: '/' })), {
    type: 'toggle-cheat-sheet',
  });

  // '?' outside editable field toggles cheat sheet
  assert.deepEqual(resolveShortcut(createEvent({ key: '?' })), {
    type: 'toggle-cheat-sheet',
  });

  // '?' inside editable field (like typing a query param in an input) does NOT trigger cheat sheet
  const inputEl = { tagName: 'INPUT' };
  assert.equal(resolveShortcut(createEvent({ key: '?', target: inputEl })), null);
});

test('resolveShortcut: Standard editing shortcuts are preserved', () => {
  // Cmd+C, Cmd+V, Cmd+Z, Cmd+A must NOT be intercepted
  assert.equal(resolveShortcut(createEvent({ metaKey: true, key: 'c' })), null);
  assert.equal(resolveShortcut(createEvent({ metaKey: true, key: 'v' })), null);
  assert.equal(resolveShortcut(createEvent({ metaKey: true, key: 'z' })), null);
  assert.equal(resolveShortcut(createEvent({ metaKey: true, key: 'a' })), null);
});

test('executeShortcut correctly invokes context handlers and calls preventDefault', () => {
  const { context, calls } = createMockContext();

  // Test new request
  let prevented = false;
  let ev = createEvent({ metaKey: true, key: 'n', preventDefault: () => (prevented = true) });
  let result = executeShortcut(ev, context);
  assert.equal(result, true);
  assert.equal(prevented, true);
  assert.equal(calls['createNewRequest']?.length, 1);

  // Test close tab
  prevented = false;
  ev = createEvent({ metaKey: true, key: 'w', preventDefault: () => (prevented = true) });
  result = executeShortcut(ev, context);
  assert.equal(result, true);
  assert.equal(prevented, true);
  assert.equal(calls['closeActiveTab']?.length, 1);

  // Test select tab by index
  ev = createEvent({ metaKey: true, key: '3' });
  executeShortcut(ev, context);
  assert.deepEqual(calls['selectTabByIndex']?.[0], [2]);

  // Test last tab
  ev = createEvent({ metaKey: true, key: '9' });
  executeShortcut(ev, context);
  assert.equal(calls['selectLastTab']?.length, 1);

  // Test send request
  ev = createEvent({ metaKey: true, key: 'Enter' });
  executeShortcut(ev, context);
  assert.equal(calls['handleSend']?.length, 1);

  // Test save request
  ev = createEvent({ metaKey: true, key: 's' });
  executeShortcut(ev, context);
  assert.equal(calls['saveActiveFile']?.length, 1);

  // Test beautify
  ev = createEvent({ metaKey: true, altKey: true, key: 'b' });
  executeShortcut(ev, context);
  assert.equal(calls['beautifyJson']?.length, 1);

  // Test close modal
  ev = createEvent({ key: 'Escape' });
  executeShortcut(ev, context);
  assert.equal(calls['closeActiveModal']?.length, 1);
});
