import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePostmanCollection } from '../src/lib/utils/postman-importer.ts';
import { parseCurlToPlayground } from '../src/lib/utils/curl-serializer.ts';

test('parsePostmanCollection parses v2.1 collection with nested folders, auth, query params, and body', () => {
  const postmanJson = JSON.stringify({
    info: {
      _postman_id: '12345',
      name: 'User Management API',
      description: 'API for managing users and profiles',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'base_url', value: 'https://api.example.com' },
      { key: 'api_token', value: 'secret_token_123' },
    ],
    item: [
      {
        name: 'Authentication',
        description: 'Login and token endpoints',
        item: [
          {
            name: 'Login User',
            event: [
              {
                listen: 'prerequest',
                script: {
                  exec: ['console.log("Starting login");', 'pm.environment.set("timestamp", Date.now());'],
                },
              },
              {
                listen: 'test',
                script: {
                  exec: [
                    'pm.test("Status code is 200", function () {',
                    '  pm.response.to.have.status(200);',
                    '});',
                  ],
                },
              },
            ],
            request: {
              method: 'POST',
              header: [{ key: 'Accept', value: 'application/json' }],
              body: {
                mode: 'raw',
                raw: JSON.stringify({ username: 'alice', password: 'password123' }),
                options: { raw: { language: 'json' } },
              },
              url: {
                raw: '{{base_url}}/auth/login?client=desktop',
                protocol: 'https',
                host: ['{{base_url}}'],
                path: ['auth', 'login'],
                query: [{ key: 'client', value: 'desktop' }],
              },
              description: 'Authenticates a user and returns a session token',
            },
          },
        ],
      },
      {
        name: 'Get Current Profile',
        request: {
          method: 'GET',
          auth: {
            type: 'bearer',
            bearer: [{ key: 'token', value: '{{api_token}}' }],
          },
          url: '{{base_url}}/user/me',
        },
      },
    ],
  });

  const result = parsePostmanCollection(postmanJson);

  assert.equal(result.collectionName, 'User Management API');
  assert.equal(result.totalRequests, 2);
  assert.equal(result.totalFolders, 1);

  // Variables
  assert.equal(result.variables.length, 2);
  assert.deepEqual(result.variables[0], ['base_url', 'https://api.example.com']);
  assert.deepEqual(result.variables[1], ['api_token', 'secret_token_123']);

  // Item 1: Login User (nested inside authentication/)
  const loginReq = result.items.find((i) => i.name === 'Login User');
  assert.ok(loginReq, 'Login request should be extracted');
  assert.equal(loginReq.relativePath, 'user_management_api/authentication/login_user.curl');
  assert.ok(loginReq.content.includes('# @name Login User'));
  assert.ok(loginReq.content.includes('curl -X POST "{{base_url}}/auth/login?client=desktop"'));
  assert.ok(loginReq.content.includes('-H "Content-Type: application/json"'));
  assert.ok(loginReq.content.includes('alice'));

  // Sidecar scripts
  assert.ok(loginReq.sidecar, 'Sidecar metadata should be extracted');
  assert.ok(loginReq.sidecar.pre_request_script?.includes('console.log("Starting login");'));
  assert.ok(loginReq.sidecar.post_response_script?.includes('pm.test("Status code is 200"'));

  // Roundtrip parse check: verify our Playground parser parses this generated curl string
  const playgroundModel = parseCurlToPlayground(loginReq.content);
  assert.equal(playgroundModel.method, 'POST');
  assert.equal(playgroundModel.name, 'Login User');
  assert.equal(playgroundModel.bodyType, 'json');

  // Item 2: Root-level request with bearer auth
  const profileReq = result.items.find((i) => i.name === 'Get Current Profile');
  assert.ok(profileReq);
  assert.equal(profileReq.relativePath, 'user_management_api/get_current_profile.curl');
  assert.ok(profileReq.content.includes('-H "Authorization: Bearer {{api_token}}"'));
});
