/**
 * Returns a workspace-relative archive path, omitting the selected collection
 * folder itself when exporting just that collection.
 */
export const COLLECTION_EXPORT_LABEL = 'Export Collection (.zip)';

export function getCollectionArchivePath(filePath: string, rootPath: string): string {
  const file = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedRoot = rootPath.replace(/\\/g, '/');
  const root = normalizedRoot.replace(/\/+$/, '') || (normalizedRoot.startsWith('/') ? '/' : '');
  const isAbsolute = file.startsWith('/') || /^[a-zA-Z]:\//.test(file);
  const rootIsAbsolute = root.startsWith('/') || /^[a-zA-Z]:$/.test(root);
  let relative = file;
  if (root === '/') {
    relative = file.replace(/^\/+/, '');
  } else if (file.startsWith(`${root}/`)) {
    relative = file.slice(root.length + 1);
  } else if (isAbsolute || rootIsAbsolute) {
    throw new Error(`Request file "${filePath}" is outside the export folder.`);
  }
  if (!relative || relative.split('/').some((part) => !part || part === '..' || part === '.')) {
    throw new Error(`Unable to create a safe archive path for "${filePath}".`);
  }
  return relative;
}
