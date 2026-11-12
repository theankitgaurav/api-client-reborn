const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_UNCOMPRESSED_SIZE = 100 * 1024 * 1024;

export interface RequestArchiveFile {
  path: string;
  content: string;
}

export function prepareRequestCollectionImport(
  files: RequestArchiveFile[],
  archiveName: string,
  existingCollectionNames: string[]
): { collectionName: string; files: RequestArchiveFile[] } {
  const baseName = archiveName
    .replace(/\.zip$/i, '')
    .replace(/[<>:"|?*\x00-\x1f/\\]/g, '_')
    .trim();
  const safeName = baseName && baseName !== '.' && baseName !== '..' ? baseName : 'Imported Collection';
  const existingNames = new Set(existingCollectionNames.map((name) => name.toLowerCase()));
  let collectionName = safeName;
  let suffix = 2;
  while (existingNames.has(collectionName.toLowerCase())) {
    collectionName = `${safeName} (${suffix++})`;
  }
  return {
    collectionName,
    files: files.map((file) => ({ ...file, path: `${collectionName}/${file.path}` })),
  };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function normalizeArchivePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe request file path in archive: ${path}`);
  }
  return normalized;
}

function addUniquePath(path: string, seenPaths: Set<string>, directories: Set<string>) {
  const key = path.toLowerCase();
  if (seenPaths.has(key) || directories.has(key)) {
    throw new Error(`Duplicate or conflicting request file path: ${path}`);
  }
  const parts = key.split('/');
  for (let index = 1; index < parts.length; index++) {
    if (seenPaths.has(parts.slice(0, index).join('/'))) {
      throw new Error(`Duplicate or conflicting request file path: ${path}`);
    }
    directories.add(parts.slice(0, index).join('/'));
  }
  seenPaths.add(key);
}

export function createRequestArchive(files: RequestArchiveFile[]): Uint8Array {
  if (files.length > 0xffff) throw new Error('Too many files for a ZIP archive.');

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const seenPaths = new Set<string>();
  const directories = new Set<string>();
  let localOffset = 0;

  for (const file of files) {
    const path = normalizeArchivePath(file.path);
    addUniquePath(path, seenPaths, directories);

    const name = encoder.encode(path);
    const content = encoder.encode(file.content);
    const checksum = crc32(content);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    write32(localView, 0, LOCAL_FILE_HEADER);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write32(localView, 14, checksum);
    write32(localView, 18, content.length);
    write32(localView, 22, content.length);
    write16(localView, 26, name.length);
    localHeader.set(name, 30);
    localParts.push(localHeader, content);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    write32(centralView, 0, CENTRAL_DIRECTORY_HEADER);
    write16(centralView, 4, 0x0314);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write32(centralView, 16, checksum);
    write32(centralView, 20, content.length);
    write32(centralView, 24, content.length);
    write16(centralView, 28, name.length);
    write32(centralView, 42, localOffset);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + content.length;
  }

  const centralDirectory = concat(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, END_OF_CENTRAL_DIRECTORY);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, centralDirectory.length);
  write32(endView, 16, localOffset);
  return concat([...localParts, centralDirectory, end]);
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const Decompressor = globalThis.DecompressionStream as unknown as
    | (new (format: string) => TransformStream<Uint8Array, Uint8Array>)
    | undefined;
  if (!Decompressor) throw new Error('This browser cannot decompress ZIP files.');
  try {
    const input = Uint8Array.from(bytes).buffer as ArrayBuffer;
    const stream = new Blob([input]).stream().pipeThrough(new Decompressor('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new Error('Unable to decompress a file in this ZIP archive.');
  }
}

function findEndRecord(view: DataView): number {
  const start = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= start; offset--) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error('This is not a valid ZIP archive.');
}

export async function readRequestArchive(buffer: ArrayBuffer): Promise<RequestArchiveFile[]> {
  const view = new DataView(buffer);
  const endOffset = findEndRecord(view);
  const entryCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error('This ZIP contains too many files.');
  if (directoryOffset + directorySize > endOffset) throw new Error('This ZIP archive is malformed.');

  const files: RequestArchiveFile[] = [];
  const seenPaths = new Set<string>();
  const directories = new Set<string>();
  let offset = directoryOffset;
  let totalSize = 0;

  for (let index = 0; index < entryCount; index++) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error('This ZIP archive has a malformed directory.');
    }
    const centralEntryOffset = offset;
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    if (flags & 1) throw new Error('Encrypted ZIP files are not supported.');
    if (name.endsWith('/')) continue;
    if (!/\.(?:curl|grpcurl|grpc)$/i.test(name)) continue;
    const path = normalizeArchivePath(name);
    addUniquePath(path, seenPaths, directories);
    totalSize += uncompressedSize;
    if (totalSize > MAX_UNCOMPRESSED_SIZE) throw new Error('The request files in this ZIP are too large.');

    if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) {
      throw new Error('This ZIP archive has a malformed file entry.');
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > buffer.byteLength) {
      throw new Error('This ZIP archive has a truncated file entry.');
    }
    const compressed = new Uint8Array(buffer, dataOffset, compressedSize);
    let contentBytes: Uint8Array;
    if (method === 0) contentBytes = compressed.slice();
    else if (method === 8) contentBytes = await inflateRaw(compressed);
    else throw new Error(`Unsupported ZIP compression method: ${method}`);

    if (contentBytes.length !== uncompressedSize) {
      throw new Error(`The ZIP entry "${path}" has an invalid size.`);
    }
    const expectedCrc = view.getUint32(centralEntryOffset + 16, true);
    if (crc32(contentBytes) !== expectedCrc) {
      throw new Error(`The ZIP entry "${path}" failed its integrity check.`);
    }
    files.push({ path, content: decoder.decode(contentBytes) });
  }

  if (files.length === 0) throw new Error('No .curl, .grpcurl, or .grpc request files were found in this ZIP.');
  return files;
}
