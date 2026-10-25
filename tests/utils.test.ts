import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCurlToPlayground,
  serializePlaygroundToCurl,
} from '../src/lib/utils/curl-serializer.ts';
import { getResolvedCommand } from '../src/lib/utils/curl-generator.ts';

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

test('getResolvedCommand correctly resolves variables in example grpc request', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const filePath = path.resolve('examples', 'get_user_grpc.grpcurl');
  const content = fs.readFileSync(filePath, 'utf-8');

  const vars = {
    grpc_host: 'localhost:50051',
    auth_token: 'secret_jwt_token',
    tenant_id: 'dev-tenant-101',
  };

  const resolved = getResolvedCommand(content, vars);
  assert.ok(!resolved.includes('# @name'));
  assert.ok(!resolved.includes('# @timeout'));
  assert.ok(resolved.includes('grpcurl -plaintext'));
  assert.ok(resolved.includes('localhost:50051 api.v1.UserService/GetUser'));
  assert.ok(resolved.includes('secret_jwt_token'));
  assert.ok(resolved.includes('dev-tenant-101'));
});

test('parseCurlToPlayground and serializePlaygroundToCurl handles gRPC requests properly', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const filePath = path.resolve('examples', 'get_user_grpc.grpcurl');
  const content = fs.readFileSync(filePath, 'utf-8');

  const model = parseCurlToPlayground(content);
  assert.equal(model.name, 'Get User gRPC');
  assert.equal(model.method, 'GRPC');
  assert.equal(model.url, '{{grpc_host}} api.v1.UserService/GetUser');
  assert.equal(model.authType, 'bearer');
  assert.equal(model.bearerToken, '{{auth_token}}');
  assert.equal(model.bodyType, 'json');
  assert.ok(model.bodyRaw.includes('"id": 42'));

  const serialized = serializePlaygroundToCurl(model);
  assert.ok(serialized.includes('grpcurl -plaintext'));
  assert.ok(serialized.includes('{{grpc_host}} api.v1.UserService/GetUser'));
  assert.ok(serialized.includes('-H "Authorization: Bearer {{auth_token}}"'));

  const reModel = parseCurlToPlayground(serialized);
  assert.equal(reModel.method, 'GRPC');
  assert.equal(reModel.url, '{{grpc_host}} api.v1.UserService/GetUser');
  assert.equal(reModel.protoFile, '');
});

test('parseCurlToPlayground and serializePlaygroundToCurl handles gRPC requests pointing to a proto file', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const filePath = path.resolve('examples', 'get_user_proto.grpcurl');
  const content = fs.readFileSync(filePath, 'utf-8');

  const model = parseCurlToPlayground(content);
  assert.equal(model.name, 'Get User with Proto File');
  assert.equal(model.method, 'GRPC');
  assert.equal(model.url, 'localhost:50052 api.v1.UserService/GetUser');
  assert.equal(model.protoFile, 'examples/user.proto');
  assert.equal(model.protoImportPath, '.');
  assert.equal(model.authType, 'bearer');
  assert.equal(model.bearerToken, 'dev_token');
  assert.equal(model.bodyType, 'json');
  assert.ok(model.bodyRaw.includes('"id": 99'));

  // Serialize back and verify -proto and -import-path are generated without manual raw editing
  const serialized = serializePlaygroundToCurl(model);
  assert.ok(serialized.includes('-proto "examples/user.proto"'));
  assert.ok(serialized.includes('-import-path "."'));
  assert.ok(serialized.includes('localhost:50052 api.v1.UserService/GetUser'));

  // Roundtrip back to model
  const roundtripModel = parseCurlToPlayground(serialized);
  assert.equal(roundtripModel.protoFile, 'examples/user.proto');
  assert.equal(roundtripModel.protoImportPath, '.');
  assert.equal(roundtripModel.url, 'localhost:50052 api.v1.UserService/GetUser');
});

test('user can switch between reflection and proto file without editing raw grpcurl tab', () => {
  const rawCommand = 'grpcurl -plaintext localhost:50051 api.v1.UserService/GetUser';
  const model = parseCurlToPlayground(rawCommand);
  assert.equal(model.method, 'GRPC');
  assert.equal(model.protoFile, '');

  // User sets proto file in Playground UI (without raw tab edit)
  model.protoFile = 'examples/user.proto';
  model.protoImportPath = '.';
  const withProto = serializePlaygroundToCurl(model);
  assert.ok(withProto.includes('-proto "examples/user.proto"'));
  assert.ok(withProto.includes('-import-path "."'));

  // User switches back to reflection mode
  model.protoFile = '';
  model.protoImportPath = '';
  const backToReflection = serializePlaygroundToCurl(model);
  assert.ok(!backToReflection.includes('-proto'));
  assert.ok(!backToReflection.includes('-import-path'));
  assert.ok(backToReflection.includes('grpcurl -plaintext'));
});

test('parseCurlToPlayground supports equals syntax flags and URL-style endpoints', () => {
  const cmd = `grpcurl -plaintext -proto=examples/user.proto -import-path=./protos -d='{"id":42}' localhost:50051/api.v1.UserService/GetUser`;
  const model = parseCurlToPlayground(cmd);

  assert.equal(model.method, 'GRPC');
  assert.equal(model.protoFile, 'examples/user.proto');
  assert.equal(model.protoImportPath, './protos');
  assert.equal(model.bodyType, 'json');
  assert.ok(model.bodyRaw.includes('"id": 42'));
  assert.equal(model.url, 'localhost:50051 api.v1.UserService/GetUser');

  // Also test with http:// prefix and -I flag
  const cmd2 = `grpcurl -plaintext -proto="examples/user.proto" -I="./protos" http://127.0.0.1:50052/api.v1.UserService/Echo`;
  const model2 = parseCurlToPlayground(cmd2);
  assert.equal(model2.method, 'GRPC');
  assert.equal(model2.protoFile, 'examples/user.proto');
  assert.equal(model2.protoImportPath, './protos');
  assert.equal(model2.url, '127.0.0.1:50052 api.v1.UserService/Echo');
});

