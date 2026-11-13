import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultGrpcRequest, parseGrpcRequest, serializeGrpcRequest, toGrpcurl } from '../src/lib/utils/grpc.ts';
import { parseGrpcurlCommand } from '../src/lib/utils/grpcurl-importer.ts';

test('imports grpcurl unary commands with plaintext, JSON, and metadata', () => {
  const config = createDefaultGrpcRequest('Echo');
  config.endpoint = 'http://127.0.0.1:50051';
  config.service = 'demo.DemoService';
  config.method = 'Echo';
  config.request_json = JSON.stringify({ message: "O'Brien", count: 1 });
  config.metadata = [{ key: 'x-demo', value: 'header value' }];

  const result = parseGrpcurlCommand(toGrpcurl(config));

  assert.equal(result.config.endpoint, config.endpoint);
  assert.equal(result.config.service, config.service);
  assert.equal(result.config.method, config.method);
  assert.equal(result.config.tls_enabled, false);
  assert.deepEqual(JSON.parse(result.config.request_json), JSON.parse(config.request_json));
  assert.deepEqual(result.config.metadata, config.metadata);
});

test('imports JSON messages piped to grpcurl for client-streaming RPCs', () => {
  const result = parseGrpcurlCommand(
    `printf '%s\\n' '{"message":"first"}' '{"message":"second"}' | grpcurl -plaintext -d @ 127.0.0.1:50051 demo.DemoService/Collect`
  );

  assert.equal(result.config.method, 'Collect');
  assert.deepEqual(JSON.parse(result.config.request_json), [{ message: 'first' }, { message: 'second' }]);
});

test('imports TLS and local proto options', () => {
  const result = parseGrpcurlCommand(
    `grpcurl -cacert '/tmp/root cert.pem' -import-path '/tmp/demo protos' -proto demo.proto -d '{}' api.example.test:443 demo.DemoService/Echo`
  );

  assert.equal(result.config.endpoint, 'https://api.example.test:443');
  assert.equal(result.config.tls_enabled, true);
  assert.equal(result.config.tls_ca_file, '/tmp/root cert.pem');
  assert.equal(result.config.proto_file, '/tmp/demo protos/demo.proto');
  assert.equal(result.config.use_reflection, false);
});

test('roundtrips TLS certificate bypass and custom CA options', () => {
  const config = createDefaultGrpcRequest('TLS Echo');
  config.endpoint = 'https://api.example.test:443';
  config.service = 'demo.DemoService';
  config.method = 'Echo';
  config.request_json = '{"message":"secure"}';
  config.tls_enabled = true;
  config.tls_insecure = true;

  const bypassCommand = toGrpcurl(config);
  assert.ok(bypassCommand.includes('-insecure'));
  const bypass = parseGrpcurlCommand(bypassCommand).config;
  assert.equal(bypass.tls_enabled, true);
  assert.equal(bypass.tls_insecure, true);
  assert.equal(bypass.tls_ca_file, null);

  config.tls_insecure = false;
  config.tls_ca_file = '/tmp/custom root.pem';
  const caCommand = serializeGrpcRequest(config);
  assert.ok(caCommand.includes("-cacert '/tmp/custom root.pem'"));
  const trusted = parseGrpcRequest(caCommand);
  assert.equal(trusted.tls_enabled, true);
  assert.equal(trusted.tls_insecure, false);
  assert.equal(trusted.tls_ca_file, '/tmp/custom root.pem');
});

test('reports invalid grpcurl commands clearly', () => {
  assert.throws(() => parseGrpcurlCommand('grpcurl -plaintext localhost:50051'), /target and a fully qualified service\/method/);
  assert.throws(() => parseGrpcurlCommand('grpcurl -plaintext -d @ localhost:50051 demo.Service/Echo'), /piped with printf/);
  assert.throws(() => parseGrpcurlCommand('grpcurl -insecure -cacert ca.pem localhost:50051 demo.Service/Echo'), /cannot combine -insecure with -cacert/);
});

test('serializeGrpcRequest formats runnable grpcurl command with metadata directives', () => {
  const config = createDefaultGrpcRequest('Say Hello Demo');
  config.timeout_ms = 15000;
  config.endpoint = 'http://127.0.0.1:50051';
  config.service = 'demo.DemoService';
  config.method = 'SayHello';
  config.request_json = '{\n  "greeting": "Hello {{tenant_id}}"\n}';
  config.metadata = [{ key: 'x-tenant', value: 'tenant-123' }];

  const serialized = serializeGrpcRequest(config);
  assert.ok(serialized.includes('# @name Say Hello Demo'));
  assert.ok(serialized.includes('# @timeout 15000'));
  assert.ok(serialized.includes('grpcurl \\\n  -plaintext'));
  assert.ok(serialized.includes("-H 'x-tenant: tenant-123'"));
  assert.ok(serialized.includes("'127.0.0.1:50051'"));
  assert.ok(serialized.includes("'demo.DemoService/SayHello'"));

  // Roundtrip test
  const roundtrip = parseGrpcRequest(serialized);
  assert.equal(roundtrip.name, 'Say Hello Demo');
  assert.equal(roundtrip.timeout_ms, 15000);
  assert.equal(roundtrip.endpoint, 'http://127.0.0.1:50051');
  assert.equal(roundtrip.service, 'demo.DemoService');
  assert.equal(roundtrip.method, 'SayHello');
  assert.equal(roundtrip.tls_enabled, false);
  assert.deepEqual(roundtrip.metadata, [{ key: 'x-tenant', value: 'tenant-123' }]);
  assert.ok(roundtrip.request_json.includes('Hello {{tenant_id}}'));
});

test('parseGrpcRequest parses legacy JSON format transparently', () => {
  const legacyJson = JSON.stringify({
    name: 'Legacy Request',
    endpoint: 'http://127.0.0.1:50051',
    service: 'demo.DemoService',
    method: 'Echo',
    request_json: '{"message": "hello"}',
    metadata: [{ key: 'x-api', value: 'test' }],
    timeout_ms: 25000,
  });

  const config = parseGrpcRequest(legacyJson);
  assert.equal(config.name, 'Legacy Request');
  assert.equal(config.service, 'demo.DemoService');
  assert.equal(config.method, 'Echo');
  assert.equal(config.timeout_ms, 25000);
  assert.deepEqual(config.metadata, [{ key: 'x-api', value: 'test' }]);
});
