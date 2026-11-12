import test from 'node:test';
import assert from 'node:assert/strict';
import { getCollectionArchivePath } from '../src/lib/utils/collection-exporter.ts';
import {
  createRequestArchive,
  prepareRequestCollectionImport,
  readRequestArchive,
} from '../src/lib/utils/request-archive.ts';

test('getCollectionArchivePath preserves paths relative to an exported collection', () => {
  assert.equal(
    getCollectionArchivePath('/workspace/services/users/list.curl', '/workspace/services'),
    'users/list.curl'
  );
  assert.equal(
    getCollectionArchivePath('/workspace/services/users/list.curl', '/workspace'),
    'services/users/list.curl'
  );
});

test('request ZIP round-trip preserves request names, extensions, folders, and exact contents', async () => {
  const files = [
    { path: 'users/list users.curl', content: '# @name List Users\ncurl "{{base_url}}/users"\r\n' },
    { path: 'payments/refund.grpcurl', content: '{"name":"Refund"}\n' },
    { path: 'payments/deep/detail.grpc', content: '{ "method": "Detail" }' },
  ];

  const archive = createRequestArchive(files);
  const restored = await readRequestArchive(
    archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength)
  );
  assert.deepEqual(restored, files);
});

test('ZIP import prefixes preserved paths under a new, collision-free collection folder', () => {
  const collection = prepareRequestCollectionImport(
    [{ path: 'api/users/list.curl', content: 'curl https://example.com' }],
    'Users.zip',
    ['users']
  );
  assert.equal(collection.collectionName, 'Users (2)');
  assert.deepEqual(collection.files, [
    { path: 'Users (2)/api/users/list.curl', content: 'curl https://example.com' },
  ]);
});

test('request ZIP rejects unsafe and duplicate paths rather than creating ambiguous imports', () => {
  assert.throws(() => createRequestArchive([{ path: '../outside.curl', content: 'curl' }]), /Unsafe/);
  assert.throws(() => createRequestArchive([
    { path: 'request.curl', content: 'first' },
    { path: 'request.curl', content: 'second' },
  ]), /Duplicate/);
  assert.throws(() => createRequestArchive([
    { path: 'Requests/item.curl', content: 'first' },
    { path: 'requests/ITEM.CURL', content: 'second' },
  ]), /Duplicate/);
  assert.throws(() => createRequestArchive([
    { path: 'requests.curl', content: 'first' },
    { path: 'requests.curl/nested.curl', content: 'second' },
  ]), /conflicting/);
});

test('request ZIP ignores unrelated files and reports archives without request files', async () => {
  const archive = createRequestArchive([{ path: 'README.md', content: 'notes' }]);
  await assert.rejects(
    readRequestArchive(archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength)),
    /No .* request files/
  );
});
