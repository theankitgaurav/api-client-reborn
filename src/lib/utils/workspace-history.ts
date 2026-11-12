function normalizePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/');
  if (normalized === '/') return normalized;
  return normalized.replace(/\/+$/, '');
}

export function buildWorkspaceOptions(defaultPath: string, recentPaths: string[]): string[] {
  const seen = new Set<string>();
  const options: string[] = [];

  for (const path of [defaultPath, ...recentPaths]) {
    const normalized = normalizePath(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    options.push(path.trim());
  }

  return options;
}
