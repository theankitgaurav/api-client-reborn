export interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SIDEBAR_WIDTH_STORAGE_KEY = 'ui_sidebar_width';
export const SIDEBAR_WIDTH_DEFAULT = 258;
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 420;

export const SPLIT_RATIO_STORAGE_KEY = 'ui_split_ratio';
export const SPLIT_RATIO_DEFAULT = 0.5;
export const SPLIT_RATIO_MIN = 0.3;
export const SPLIT_RATIO_MAX = 0.7;

export type SplitOrientation = 'vertical' | 'horizontal';
export const SPLIT_ORIENTATION_STORAGE_KEY = 'ui_split_orientation';
export const SPLIT_ORIENTATION_DEFAULT: SplitOrientation = 'vertical';

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.round(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width)));
}

export function readSidebarWidth(storage: Pick<LayoutStorage, 'getItem'> | undefined): number {
  const stored = storage?.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (stored === null || stored === undefined || stored.trim() === '') return SIDEBAR_WIDTH_DEFAULT;

  const width = Number(stored);
  return Number.isFinite(width) ? clampSidebarWidth(width) : SIDEBAR_WIDTH_DEFAULT;
}

export function persistSidebarWidth(
  storage: Pick<LayoutStorage, 'setItem'> | undefined,
  width: number
): number {
  const clampedWidth = clampSidebarWidth(width);
  storage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampedWidth));
  return clampedWidth;
}

export function resetSidebarWidth(storage: Pick<LayoutStorage, 'setItem'> | undefined): number {
  return persistSidebarWidth(storage, SIDEBAR_WIDTH_DEFAULT);
}

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return SPLIT_RATIO_DEFAULT;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio));
}

export function persistSplitRatio(
  storage: Pick<LayoutStorage, 'setItem'> | undefined,
  ratio: number
): number {
  const clampedRatio = clampSplitRatio(ratio);
  storage?.setItem(SPLIT_RATIO_STORAGE_KEY, String(clampedRatio));
  return clampedRatio;
}

export function resetSplitRatio(storage: Pick<LayoutStorage, 'setItem'> | undefined): number {
  return persistSplitRatio(storage, SPLIT_RATIO_DEFAULT);
}

export function readSplitOrientation(
  storage: Pick<LayoutStorage, 'getItem'> | undefined
): SplitOrientation {
  return storage?.getItem(SPLIT_ORIENTATION_STORAGE_KEY) === 'horizontal'
    ? 'horizontal'
    : SPLIT_ORIENTATION_DEFAULT;
}

export function persistSplitLayout(
  storage: Pick<LayoutStorage, 'setItem'> | undefined,
  orientation: SplitOrientation
): { orientation: SplitOrientation; ratio: number } {
  storage?.setItem(SPLIT_ORIENTATION_STORAGE_KEY, orientation);
  const ratio = resetSplitRatio(storage);
  return { orientation, ratio };
}
