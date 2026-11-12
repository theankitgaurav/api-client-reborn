export async function saveArchiveWithDialog(
  contents: Uint8Array,
  defaultPath: string,
  choosePath: (defaultPath: string) => Promise<string | null>,
  writeFile: (path: string, contents: Uint8Array) => Promise<void>
): Promise<boolean> {
  const path = await choosePath(defaultPath);
  if (!path) return false;
  await writeFile(path, contents);
  return true;
}
