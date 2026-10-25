import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCollectionShellScript,
  type FlattenedRequest,
} from '../src/lib/utils/collection-exporter.ts';

test('generateCollectionShellScript creates executable bash script with status checks and variables', () => {
  const requests: FlattenedRequest[] = [
    {
      path: '/workspace/users/get_users.curl',
      name: 'List Users',
      method: 'GET',
      command: '# @name List Users\ncurl -X GET "{{base_url}}/users"',
      isGrpc: false,
    },
    {
      path: '/workspace/users/get_user_grpc.grpcurl',
      name: 'Get User gRPC',
      method: 'gRPC',
      command: 'grpcurl -plaintext -d \'{"id": 42}\' localhost:50051 users.UserService/GetUser',
      isGrpc: true,
    },
  ];

  const envVars = {
    base_url: 'https://staging.api.com',
  };

  const script = generateCollectionShellScript('User Services', requests, envVars);

  assert.ok(script.startsWith('#!/usr/bin/env bash'));
  assert.ok(script.includes('Collection Runner: User Services'));
  assert.ok(script.includes('export base_url="${base_url:-"https://staging.api.com"}"'));
  assert.ok(script.includes('List Users'));
  assert.ok(script.includes('HTTP_CODE='));
  assert.ok(script.includes('grpcurl -plaintext'));
  assert.ok(script.includes('[gRPC OK]'));
  assert.ok(script.includes('Summary: ${TOTAL_REQUESTS} Total'));
});
