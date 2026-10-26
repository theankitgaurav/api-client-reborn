import type { SidecarMetadata, TestResultItem } from '../types';

export interface TabResponseData {
  status: number | null;
  statusText: string;
  protocol: string;
  ttfbMs: number | null;
  durationMs: number | null;
  totalBytes: number;
  headers: { key: string; value: string }[];
  bodyText: string;
  streamMessages: any[];
  isStreaming?: boolean;
  error: string | null;
  activeTab: 'body' | 'headers' | 'stream' | 'tests' | 'raw';
  testResults: TestResultItem[];
  scriptLogs: string[];
  isBodyTruncated?: boolean;
  totalEventsCount?: number;
  spoolFilePath?: string | null;
}

export interface TabItem {
  id: string;
  filePath: string | null; // null if unsaved draft ("Untitled Request")
  name: string;
  method: string;
  rawContent: string;
  isDirty: boolean;
  isPinned: boolean;       // false = preview tab; true = pinned tab
  sidecar?: SidecarMetadata;
  response?: TabResponseData;
}

/**
 * Normalizes folder path by removing trailing slashes.
 */
export function normalizeFolderPath(path: string): string {
  if (!path || path === '.') return '.';
  const normalized = path.replace(/[\\\/]+$/, '');
  return normalized || '.';
}

/**
 * Cascades directory rename to all open tabs residing within that directory.
 * Strips trailing slashes from oldPath and newPath.
 * Matches tabs whose filePath equals oldPath or starts with oldPath + '/'.
 * Preserves all other tab state.
 */
export function cascadeFolderRename(
  tabs: TabItem[],
  oldPath: string,
  newPath: string
): TabItem[] {
  const normOld = oldPath.replace(/[\\\/]+$/, '');
  const normNew = newPath.replace(/[\\\/]+$/, '');

  if (!normOld) {
    return tabs;
  }

  const prefix = normOld + '/';

  return tabs.map((tab) => {
    if (!tab.filePath) {
      return tab;
    }

    if (tab.filePath === normOld) {
      return { ...tab, filePath: normNew };
    }

    if (tab.filePath.startsWith(prefix)) {
      const remainder = tab.filePath.slice(normOld.length);
      return { ...tab, filePath: `${normNew}${remainder}` };
    }

    return tab;
  });
}

/**
 * Partitions tabs into remaining tabs and closed tabs when a folder is deleted.
 * Strictly matches only items within the folder boundary (filePath === folder or starts with folder + '/').
 * Avoids false prefix matches on sibling directories (e.g. /auth vs /auth-helpers).
 */
export function filterTabsOnFolderDelete(
  tabs: TabItem[],
  deletedFolderPath: string
): { remainingTabs: TabItem[]; closedTabs: TabItem[] } {
  const normFolder = deletedFolderPath.replace(/[\\\/]+$/, '');

  if (!normFolder) {
    return { remainingTabs: [...tabs], closedTabs: [] };
  }

  const prefix = normFolder + '/';
  const remainingTabs: TabItem[] = [];
  const closedTabs: TabItem[] = [];

  for (const tab of tabs) {
    if (tab.filePath && (tab.filePath === normFolder || tab.filePath.startsWith(prefix))) {
      closedTabs.push(tab);
    } else {
      remainingTabs.push(tab);
    }
  }

  return { remainingTabs, closedTabs };
}

/**
 * Resolves which tab to replace when "Open in Current Tab" or preview is triggered.
 * Checks activeTab first: if active tab is clean (!isDirty) and unpinned (!isPinned), returns activeTab.
 * If active tab is not clean/unpinned, checks for another unpinned and clean preview tab.
 * Otherwise returns shouldAppend: true.
 */
export function resolveTargetTabForOpenCurrent(
  tabs: TabItem[],
  activeTabId: string | null
): { tabToReplace: TabItem | null; shouldAppend: boolean } {
  if (activeTabId) {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab && !activeTab.isDirty && !activeTab.isPinned) {
      return { tabToReplace: activeTab, shouldAppend: false };
    }
  }

  const previewTab = tabs.find((t) => !t.isPinned && !t.isDirty);
  if (previewTab) {
    return { tabToReplace: previewTab, shouldAppend: false };
  }

  return { tabToReplace: null, shouldAppend: true };
}

/**
 * Generates a unique filename for duplicate requests (<stem>_copy.<ext> or <stem>_copy_{n}.<ext>).
 * Detects collisions against existing names.
 */
export function formatDuplicateRequestName(
  stem: string,
  existingNames: string[],
  ext?: string
): string {
  const extension = (ext || 'curl').replace(/^\./, '');
  let cleanStem = stem.replace(/\.curl$/i, '');

  // Strip trailing extension if matching
  if (cleanStem.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) {
    cleanStem = cleanStem.slice(0, -(extension.length + 1));
  }

  const isCollision = (candidate: string) => {
    return existingNames.some(
      (name) =>
        name === candidate ||
        name.endsWith('/' + candidate) ||
        name.endsWith('\\' + candidate)
    );
  };

  const firstCandidate = `${cleanStem}_copy.${extension}`;
  if (!isCollision(firstCandidate)) {
    return firstCandidate;
  }

  let counter = 2;
  while (true) {
    const candidate = `${cleanStem}_copy_${counter}.${extension}`;
    if (!isCollision(candidate)) {
      return candidate;
    }
    counter++;
  }
}

/**
 * Sanitizes request rename input, strictly preserving the .curl extension
 * even if omitted or mismatched in user input.
 */
export function sanitizeRequestRename(currentPath: string, newNameInput: string): string {
  let ext = '.curl';
  const lowerCurrent = currentPath.toLowerCase();
  if (lowerCurrent.endsWith('.curl')) {
    ext = '.curl';
  } else {
    const match = currentPath.match(/\.([a-zA-Z0-9]+)$/);
    if (match) {
      ext = `.${match[1]}`;
    }
  }

  let base = newNameInput.trim();

  // Strip any typed .curl extension
  base = base.replace(/\.curl$/i, '');

  // If ext is non-standard, also strip if present
  if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) {
    base = base.slice(0, -ext.length);
  }

  // Replace any slashes to prevent directory injection in file rename
  base = base.replace(/[\\\/]+/g, '_');

  // Fallback if base is empty
  if (!base) {
    const currentLeaf = currentPath.split(/[\\\/]/).pop() || 'request';
    base = currentLeaf.replace(/\.curl$/i, '') || 'request';
  }

  return `${base}${ext}`;
}

/**
 * Updates or inserts the `# @name <newDisplayName>` comment line in raw request content.
 */
export function updateRequestNameHeader(rawContent: string, newDisplayName: string): string {
  const trimmed = rawContent.trim();
  const nameLineRegex = /(^[ \t]*#[ \t]*@name\b)(?:[ \t]+.*)?$/m;

  if (nameLineRegex.test(rawContent)) {
    return rawContent.replace(nameLineRegex, `# @name ${newDisplayName}`);
  }

  if (trimmed.length === 0) {
    return `# @name ${newDisplayName}\n`;
  }

  return `# @name ${newDisplayName}\n${rawContent}`;
}
