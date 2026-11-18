import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCurlToPlayground,
  serializePlaygroundToCurl,
} from '../src/lib/utils/curl-serializer.ts';
import { getResolvedCommand } from '../src/lib/utils/curl-generator.ts';
import { HTTP_HEADER_NAMES, httpHeaderValues } from '../src/lib/utils/http-headers.ts';
import { updateStoredRequestName } from '../src/lib/utils/workspace-sync.ts';
import { formatResponseBody } from '../src/lib/utils/response-body.ts';
import { appendVariableDraft } from '../src/lib/utils/variable-drafts.ts';
import type { VariableItem } from '../src/lib/types.ts';
import { hasDuplicateEnvironmentName, isDefaultEnvironmentName, normalizeEnvironmentName } from '../src/lib/utils/environment.ts';

test('environment names trim whitespace and reject duplicates case-insensitively or by slug', () => {
  assert.equal(normalizeEnvironmentName('  staging  '), 'staging');
  assert.equal(hasDuplicateEnvironmentName([
    { name: 'development', file_path: '/environments/development.env.json', variables: [] },
  ], ' DEVELOPMENT '), true);
  assert.equal(hasDuplicateEnvironmentName([
    { name: 'development', file_path: '/environments/development.env.json', variables: [] },
  ], 'production'), false);
  assert.equal(hasDuplicateEnvironmentName([
    { name: 'QA Env', file_path: '/environments/qa_env.env.json', variables: [] },
  ], 'QA-Env'), true);
});

test('default environment names are protected case-insensitively', () => {
  assert.equal(isDefaultEnvironmentName('default'), true);
  assert.equal(isDefaultEnvironmentName('  DEFAULT  '), true);
  assert.equal(isDefaultEnvironmentName('development'), false);
});

test('pending variable drafts are trimmed and committed before save', () => {
  const existing: VariableItem[] = [];
  const result = appendVariableDraft(
    existing,
    { key: '  base_url  ', value: 'https://api.example.test', isSecret: false, scope: 'collection' },
    'draft-1',
  );

  assert.deepEqual(result, [{
    id: 'draft-1',
    key: 'base_url',
    value: 'https://api.example.test',
    isSecret: false,
    scope: 'collection',
  }]);
  assert.deepEqual(appendVariableDraft(result, { key: '   ', value: 'ignored', isSecret: false, scope: 'collection' }, 'draft-2'), result);
});

test('formats JSON responses without altering numeric or string literals', () => {
  const body = '{"id":9007199254740993,"amount":1.00e+3,"items":[{},[],{"text":"a, \\"b\\""}]}';
  assert.equal(formatResponseBody(body, false, false, false),
    '{\n  "id": 9007199254740993,\n  "amount": 1.00e+3,\n  "items": [\n    {},\n    [],\n    {\n      "text": "a, \\"b\\""\n    }\n  ]\n}');
});

test('leaves invalid, incomplete, streaming and truncated bodies unchanged', () => {
  const body = '{"value":1}';
  assert.equal(formatResponseBody('{"value":', false, false, false), '{"value":');
  assert.equal(formatResponseBody('plain text', false, false, false), 'plain text');
  assert.equal(formatResponseBody(body, true, false, false), body);
  assert.equal(formatResponseBody(body, false, true, false), body);
  assert.equal(formatResponseBody(body, false, false, true), body);
});

test('header value suggestions depend on the case-insensitive header name', () => {
  assert.ok(HTTP_HEADER_NAMES.includes('Content-Type'));
  assert.ok(httpHeaderValues(' content-TYPE ').includes('application/json'));
  assert.ok(httpHeaderValues('Accept').includes('text/event-stream'));
  assert.deepEqual(httpHeaderValues('X-Custom'), []);
});

test('request name updates preserve request content and literal replacement characters', () => {
  const raw = '# @name Old\n# @description Keep\ncurl https://example.com';
  assert.equal(updateStoredRequestName(raw, 'New $& name', 'http'),
    '# @name New $& name\n# @description Keep\ncurl https://example.com');
  assert.equal(updateStoredRequestName('# @name Old\ngrpcurl localhost service/method', 'New name', 'grpc'),
    '# @name New name\ngrpcurl localhost service/method');
});

test('parseCurlToPlayground parses GET with query params and headers', () => {
  const input = `# @name Get Users
# @timeout 15000

curl -X GET "https://api.example.com/users?role=admin&active=true" \\
  -H "Accept: application/json" \\
  -H "Authorization: Bearer token123"`;

  const model = parseCurlToPlayground(input);
  assert.equal(model.name, 'Get Users');
  assert.equal(model.timeoutMs, 15000);
  assert.equal(model.method, 'GET');
  assert.equal(model.url, 'https://api.example.com/users');
  assert.equal(model.params.length, 2);
  assert.equal(model.params[0].key, 'role');
  assert.equal(model.params[0].value, 'admin');
  assert.equal(model.params[1].key, 'active');
  assert.equal(model.params[1].value, 'true');

  assert.equal(model.authType, 'bearer');
  assert.equal(model.bearerToken, 'token123');
});

test('parseCurlToPlayground parses POST with JSON payload', () => {
  const input = `# @name Create User
# @timeout 5000

curl -X POST "https://api.example.com/users" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Alice", "role": "admin"}'`;

  const model = parseCurlToPlayground(input);
  assert.equal(model.name, 'Create User');
  assert.equal(model.method, 'POST');
  assert.equal(model.bodyType, 'json');
  assert.ok(model.bodyRaw.includes('"name": "Alice"'));
});

test('parseCurlToPlayground detects streaming -N flag', () => {
  const input = `# @name Stream Logs
curl -N "https://api.example.com/stream" -H "Accept: text/event-stream"`;

  const model = parseCurlToPlayground(input);
  assert.equal(model.noBuffer, true);
  assert.equal(model.url, 'https://api.example.com/stream');
});

test('serializePlaygroundToCurl produces executable curl script with -N and query params', () => {
  const model = parseCurlToPlayground(
    'curl -N "https://api.example.com/live?channel=alerts" -H "Accept: text/event-stream"'
  );
  model.name = 'Live Alerts';
  model.timeoutMs = 45000;

  const serialized = serializePlaygroundToCurl(model);
  assert.ok(serialized.includes('# @name Live Alerts'));
  assert.ok(serialized.includes('# @timeout 45000'));
  assert.ok(serialized.includes('curl -N -X GET'));
  assert.ok(serialized.includes('channel=alerts'));
  assert.ok(serialized.includes('text/event-stream'));
});

test('getResolvedCommand substitutes variables and dynamic generators', () => {
  const input = `# @name Sample
# @timeout 10000

curl -X GET "{{base_url}}/items" \\
  -H "X-Trace: {{$uuid}}" \\
  -H "X-Time: {{$timestamp}}" \\
  -H "Authorization: Bearer {{token}}"`;

  const vars = {
    base_url: 'https://staging.internal',
    token: 'sec_xyz',
  };

  const resolved = getResolvedCommand(input, vars);

  // Comments stripped
  assert.ok(!resolved.includes('# @name'));
  assert.ok(!resolved.includes('# @timeout'));

  // Variables substituted
  assert.ok(resolved.includes('https://staging.internal/items'));
  assert.ok(resolved.includes('sec_xyz'));

  // Dynamic UUID substituted
  assert.ok(!resolved.includes('{{$uuid}}'));
  assert.match(resolved, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);

  // Dynamic timestamp substituted
  assert.ok(!resolved.includes('{{$timestamp}}'));
});

test('Roundtrip fidelity on example curl files', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const files = ['get_users.curl', 'create_user.curl', 'stream_events.curl'];
  for (const f of files) {
    const filePath = path.resolve('examples', f);
    const content = fs.readFileSync(filePath, 'utf-8');

    const model = parseCurlToPlayground(content);
    assert.ok(model.name, `Model for ${f} should have a name`);
    assert.ok(model.url, `Model for ${f} should have a url`);

    const reSerialized = serializePlaygroundToCurl(model);
    const reModel = parseCurlToPlayground(reSerialized);

    assert.equal(reModel.name, model.name, `Name mismatch on roundtrip for ${f}`);
    assert.equal(reModel.method, model.method, `Method mismatch on roundtrip for ${f}`);
    assert.equal(reModel.bodyType, model.bodyType, `BodyType mismatch on roundtrip for ${f}`);
    assert.equal(reModel.noBuffer, model.noBuffer, `NoBuffer mismatch on roundtrip for ${f}`);
  }
});

test('IPC: getMcpConfigInfo returns workspace and executable path', async () => {
  const { getMcpConfigInfo } = await import('../src/lib/ipc.ts');
  const info = await getMcpConfigInfo();
  assert.ok(info);
  assert.ok(typeof info.workspace_path === 'string');
  assert.ok(typeof info.executable_path === 'string');
  assert.ok(info.workspace_path.length > 0);
  assert.ok(info.executable_path.length > 0);
});


