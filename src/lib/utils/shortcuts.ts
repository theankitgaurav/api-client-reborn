export interface ShortcutItem {
  id: string;
  category: 'Tabs' | 'Request' | 'Navigation' | 'General';
  label: string;
  description: string;
  macKeys: string[];
  winKeys: string[];
}

export const SHORTCUT_DEFINITIONS: ShortcutItem[] = [
  // Tabs
  {
    id: 'new-request',
    category: 'Tabs',
    label: 'New Request',
    description: 'Create a new untitled request in a new tab',
    macKeys: ['⌘', 'N'],
    winKeys: ['Ctrl', 'N'],
  },
  {
    id: 'close-tab',
    category: 'Tabs',
    label: 'Close Active Tab',
    description: 'Close current request tab (prompts if unsaved changes)',
    macKeys: ['⌘', 'W'],
    winKeys: ['Ctrl', 'W'],
  },
  {
    id: 'close-other-tabs',
    category: 'Tabs',
    label: 'Close Other Tabs',
    description: 'Close all tabs except the currently active one',
    macKeys: ['⌘', '⌥', 'W'],
    winKeys: ['Ctrl', 'Alt', 'W'],
  },
  {
    id: 'next-tab',
    category: 'Tabs',
    label: 'Next Tab',
    description: 'Switch to the next tab on the right',
    macKeys: ['Ctrl', 'Tab'],
    winKeys: ['Ctrl', 'Tab'],
  },
  {
    id: 'previous-tab',
    category: 'Tabs',
    label: 'Previous Tab',
    description: 'Switch to the previous tab on the left',
    macKeys: ['Ctrl', '⇧', 'Tab'],
    winKeys: ['Ctrl', 'Shift', 'Tab'],
  },
  {
    id: 'tab-1-8',
    category: 'Tabs',
    label: 'Go to Tab 1-8',
    description: 'Directly switch to the tab at specified index',
    macKeys: ['⌘', '1..8'],
    winKeys: ['Ctrl', '1..8'],
  },
  {
    id: 'last-tab',
    category: 'Tabs',
    label: 'Go to Last Tab',
    description: 'Directly switch to the last open tab',
    macKeys: ['⌘', '9'],
    winKeys: ['Ctrl', '9'],
  },

  // Request Execution & Saving
  {
    id: 'send-request',
    category: 'Request',
    label: 'Send / Cancel Request',
    description: 'Execute current request or cancel if already running',
    macKeys: ['⌘', '↵'],
    winKeys: ['Ctrl', 'Enter'],
  },
  {
    id: 'save-request',
    category: 'Request',
    label: 'Save Request',
    description: 'Save changes to disk or open save dialog for drafts',
    macKeys: ['⌘', 'S'],
    winKeys: ['Ctrl', 'S'],
  },
  {
    id: 'beautify-json',
    category: 'Request',
    label: 'Beautify JSON',
    description: 'Format raw JSON request body with 2-space indentation',
    macKeys: ['⌘', '⌥', 'B'],
    winKeys: ['Ctrl', 'Alt', 'B'],
  },

  // Navigation
  {
    id: 'focus-url',
    category: 'Navigation',
    label: 'Focus URL Bar',
    description: 'Jump cursor to request URL/endpoint input and select all text',
    macKeys: ['⌘', 'L'],
    winKeys: ['Ctrl', 'L'],
  },
  {
    id: 'focus-filter',
    category: 'Navigation',
    label: 'Filter Requests',
    description: 'Focus sidebar search to filter request collections',
    macKeys: ['⌘', 'F'],
    winKeys: ['Ctrl', 'F'],
  },
  {
    id: 'open-variables',
    category: 'Navigation',
    label: 'Variables & Secrets',
    description: 'Open the Workspace Variables and Secrets configuration modal',
    macKeys: ['⌘', 'E'],
    winKeys: ['Ctrl', 'E'],
  },

  // General
  {
    id: 'close-modal',
    category: 'General',
    label: 'Dismiss / Close Dialog',
    description: 'Close active modal dialog or unfocus active input',
    macKeys: ['Esc'],
    winKeys: ['Esc'],
  },
  {
    id: 'cheat-sheet',
    category: 'General',
    label: 'Keyboard Shortcuts',
    description: 'Open this keyboard shortcuts reference sheet',
    macKeys: ['⌘', '/'],
    winKeys: ['Ctrl', '/'],
  },
];

export type ShortcutActionType =
  | 'new-request'
  | 'close-tab'
  | 'close-other-tabs'
  | 'next-tab'
  | 'previous-tab'
  | 'select-tab'
  | 'last-tab'
  | 'send-request'
  | 'save-request'
  | 'beautify-json'
  | 'focus-url'
  | 'focus-filter'
  | 'toggle-variables'
  | 'close-modal'
  | 'toggle-cheat-sheet';

export interface ResolvedShortcut {
  type: ShortcutActionType;
  tabIndex?: number;
}

export interface KeyboardEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault?: () => void;
  target?: any;
}

export interface ShortcutContext {
  createNewRequest: () => void;
  closeActiveTab: () => void;
  closeOtherTabs: () => void;
  nextTab: () => void;
  previousTab: () => void;
  selectTabByIndex: (index: number) => void;
  selectLastTab: () => void;
  saveActiveFile: () => void;
  handleSend: () => void;
  beautifyJson?: () => void;
  focusUrlInput?: () => void;
  focusFilterInput?: () => void;
  toggleVariablesModal: () => void;
  closeActiveModal: () => boolean;
  toggleCheatSheet: () => void;
}

let beautifyHandler: (() => void) | null = null;

export function registerBeautifyHandler(fn: (() => void) | null) {
  beautifyHandler = fn;
}

export function triggerBeautifyJson() {
  beautifyHandler?.();
}

/**
 * Resolves a keyboard event to an application shortcut action, if matching.
 */
export function resolveShortcut(e: KeyboardEventLike): ResolvedShortcut | null {
  const isMod = e.metaKey || e.ctrlKey;
  const target = e.target as HTMLElement | null;
  const isEditable = Boolean(
    target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        (target as any).isContentEditable)
  );

  // 1. Escape: Dismiss open modals or blur active editable
  if (e.key === 'Escape') {
    return { type: 'close-modal' };
  }

  // 2. Shortcuts Cheat Sheet: Cmd+/ or Ctrl+/ (or ? when not in an editable field)
  if (
    (isMod && !e.altKey && (e.key === '/' || e.key === '?')) ||
    (!isEditable && !isMod && !e.altKey && e.key === '?')
  ) {
    return { type: 'toggle-cheat-sheet' };
  }

  // 3. New Request: Cmd+N / Ctrl+N
  if (isMod && !e.shiftKey && !e.altKey && (e.key === 'n' || e.key === 'N')) {
    return { type: 'new-request' };
  }

  // 4. Close Active Tab: Cmd+W / Ctrl+W (or Cmd+Option+W to close other tabs)
  if (isMod && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
    if (e.altKey) {
      return { type: 'close-other-tabs' };
    }
    return { type: 'close-tab' };
  }

  // 5. Save Request: Cmd+S / Ctrl+S
  if (isMod && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
    return { type: 'save-request' };
  }

  // 6. Send Request / Cancel: Cmd+Enter / Ctrl+Enter
  if (isMod && e.key === 'Enter') {
    return { type: 'send-request' };
  }

  // 7. Focus URL Bar: Cmd+L / Ctrl+L
  if (isMod && !e.shiftKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
    return { type: 'focus-url' };
  }

  // 8. Focus Request Filter: Cmd+F / Ctrl+F (or Cmd+P / Ctrl+P)
  if (
    isMod &&
    !e.shiftKey &&
    !e.altKey &&
    (e.key === 'f' || e.key === 'F' || e.key === 'p' || e.key === 'P')
  ) {
    return { type: 'focus-filter' };
  }

  // 9. Variables & Secrets: Cmd+E / Ctrl+E
  if (isMod && !e.shiftKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
    return { type: 'toggle-variables' };
  }

  // 10. Beautify JSON: Cmd+Option+B / Ctrl+Alt+B
  if (isMod && e.altKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
    return { type: 'beautify-json' };
  }

  // 11. Next Tab: Ctrl+Tab, Cmd+Option+Right, Cmd+Shift+]
  if (
    (!e.metaKey && e.ctrlKey && !e.shiftKey && e.key === 'Tab') ||
    (isMod && e.altKey && e.key === 'ArrowRight') ||
    (isMod && e.shiftKey && (e.key === ']' || e.key === '}'))
  ) {
    return { type: 'next-tab' };
  }

  // 12. Previous Tab: Ctrl+Shift+Tab, Cmd+Option+Left, Cmd+Shift+[
  if (
    (!e.metaKey && e.ctrlKey && e.shiftKey && e.key === 'Tab') ||
    (isMod && e.altKey && e.key === 'ArrowLeft') ||
    (isMod && e.shiftKey && (e.key === '[' || e.key === '{'))
  ) {
    return { type: 'previous-tab' };
  }

  // 13. Go to Tab 1-8: Cmd+1..8 / Ctrl+1..8
  if (isMod && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '8') {
    return { type: 'select-tab', tabIndex: parseInt(e.key, 10) - 1 };
  }

  // 14. Go to Last Tab: Cmd+9 / Ctrl+9
  if (isMod && !e.shiftKey && !e.altKey && e.key === '9') {
    return { type: 'last-tab' };
  }

  return null;
}

/**
 * Executes a shortcut action using the provided context.
 * Returns true if an action was executed.
 */
export function executeShortcut(e: KeyboardEventLike, context: ShortcutContext): boolean {
  const resolved = resolveShortcut(e);
  if (!resolved) return false;

  switch (resolved.type) {
    case 'close-modal': {
      const closed = context.closeActiveModal();
      if (closed) {
        e.preventDefault?.();
        return true;
      }
      const target = e.target as HTMLElement | null;
      if (target && typeof target.blur === 'function') {
        target.blur();
        e.preventDefault?.();
        return true;
      }
      return false;
    }
    case 'toggle-cheat-sheet':
      e.preventDefault?.();
      context.toggleCheatSheet();
      return true;
    case 'new-request':
      e.preventDefault?.();
      context.createNewRequest();
      return true;
    case 'close-tab':
      e.preventDefault?.();
      context.closeActiveTab();
      return true;
    case 'close-other-tabs':
      e.preventDefault?.();
      context.closeOtherTabs();
      return true;
    case 'save-request':
      e.preventDefault?.();
      context.saveActiveFile();
      return true;
    case 'send-request':
      e.preventDefault?.();
      context.handleSend();
      return true;
    case 'focus-url':
      e.preventDefault?.();
      context.focusUrlInput?.();
      return true;
    case 'focus-filter':
      e.preventDefault?.();
      context.focusFilterInput?.();
      return true;
    case 'toggle-variables':
      e.preventDefault?.();
      context.toggleVariablesModal();
      return true;
    case 'beautify-json':
      e.preventDefault?.();
      if (context.beautifyJson) {
        context.beautifyJson();
      } else {
        triggerBeautifyJson();
      }
      return true;
    case 'next-tab':
      e.preventDefault?.();
      context.nextTab();
      return true;
    case 'previous-tab':
      e.preventDefault?.();
      context.previousTab();
      return true;
    case 'select-tab':
      if (resolved.tabIndex !== undefined) {
        e.preventDefault?.();
        context.selectTabByIndex(resolved.tabIndex);
        return true;
      }
      return false;
    case 'last-tab':
      e.preventDefault?.();
      context.selectLastTab();
      return true;
    default:
      return false;
  }
}
