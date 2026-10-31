import type { RequestHistoryEntry, SidecarMetadata, TestResultItem, WorkspaceFileItem } from '../types';

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
  requestType?: 'http' | 'grpc';
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
 * Removes a workspace item from a scanned request tree without mutating the
 * existing tree. Matching normalizes slash direction and trailing slashes so
 * paths from the filesystem and the UI compare consistently.
 */
export function removeWorkspaceItem(
  items: WorkspaceFileItem[],
  targetPath: string
): WorkspaceFileItem[] {
  const normalizePath = (path: string) => {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    return normalized || '/';
  };
  const normalizedTarget = normalizePath(targetPath);

  return items
    .filter((item) => normalizePath(item.path) !== normalizedTarget)
    .map((item) =>
      item.children
        ? { ...item, children: removeWorkspaceItem(item.children, targetPath) }
        : item
    );
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

export function openHistoryEntryInTabs(
  tabs: TabItem[],
  activeTabId: string | null,
  entry: RequestHistoryEntry,
  id: string
): { tabs: TabItem[]; activeTabId: string; openedTab: TabItem } {
  const { tabToReplace } = resolveTargetTabForOpenCurrent(tabs, activeTabId);
  const openedTab: TabItem = {
    id,
    filePath: null,
    name: entry.request_name,
    method: entry.method,
    requestType: entry.request_path?.toLowerCase().endsWith('.grpc') || entry.raw_command.trimStart().startsWith('{')
      ? 'grpc'
      : 'http',
    rawContent: entry.raw_command,
    isDirty: false,
    isPinned: false,
    sidecar: { tests: [] },
    response: {
      status: entry.status,
      statusText: entry.status_text,
      protocol: '',
      ttfbMs: null,
      durationMs: entry.duration_ms,
      totalBytes: entry.total_bytes,
      headers: entry.headers,
      bodyText: entry.response_body,
      streamMessages: [],
      isStreaming: entry.is_streaming,
      error: entry.error,
      activeTab: 'body',
      testResults: [],
      scriptLogs: [],
      isBodyTruncated: false,
      totalEventsCount: 0,
      spoolFilePath: null,
    },
  };

  if (tabToReplace) {
    const updatedTabs = tabs.map((tab) => tab.id === tabToReplace.id ? openedTab : tab);
    return { tabs: updatedTabs, activeTabId: openedTab.id, openedTab };
  }

  const updatedTabs = [...tabs, openedTab];
  return { tabs: updatedTabs, activeTabId: openedTab.id, openedTab };
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
 * Sanitizes request rename input, strictly preserving its request extension.
 */
export function sanitizeRequestRename(currentPath: string, newNameInput: string): string {
  const lowerCurrent = currentPath.toLowerCase();
  const ext = lowerCurrent.endsWith('.grpc') ? '.grpc' : '.curl';

  let base = newNameInput.trim();

  // Strip a typed request extension before preserving the source type.
  base = base.replace(/\.(?:curl|grpc)$/i, '');

  // If ext is non-standard, also strip if present
  if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) {
    base = base.slice(0, -ext.length);
  }

  // Replace any slashes to prevent directory injection in file rename
  base = base.replace(/[\\\/]+/g, '_');

  // Fallback if base is empty
  if (!base) {
    const currentLeaf = currentPath.split(/[\\\/]/).pop() || 'request';
    base = currentLeaf.replace(/\.(?:curl|grpc)$/i, '') || 'request';
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
