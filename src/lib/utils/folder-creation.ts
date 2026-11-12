export async function createFolderFromName(
  value: string,
  createFolder: (name: string) => Promise<unknown>
): Promise<boolean> {
  const name = value.trim();
  if (!name) return false;
  await createFolder(name);
  return true;
}
