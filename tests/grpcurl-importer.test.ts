import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultGrpcRequest, toGrpcurl } from '../src/lib/utils/grpc.ts';
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

test('reports invalid grpcurl commands clearly', () => {
  assert.throws(() => parseGrpcurlCommand('grpcurl -plaintext localhost:50051'), /target and a fully qualified service\/method/);
  assert.throws(() => parseGrpcurlCommand('grpcurl -plaintext -d @ localhost:50051 demo.Service/Echo'), /piped with printf/);
});
