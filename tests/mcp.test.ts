import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { McpServer } from '../src/mcp/server.ts';
import { MCP_PROTOCOL_VERSION, SERVER_NAME, JsonRpcErrorCode } from '../src/mcp/protocol.ts';

// Helper to create an isolated temporary workspace directory
function createTempWorkspace(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-client-mcp-test-'));

  // 1. Setup collections
  fs.mkdirSync(path.join(tmpDir, 'auth'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'auth', 'login.curl'),
    `# @name User Login
# @description Authenticates user and returns JWT token
# @timeout 10000

curl -X POST "{{base_url}}/api/login" \\
  -H "Content-Type: application/json" \\
  -d '{"username": "tester", "password": "{{api_secret}}"}'
`
  );

  fs.writeFileSync(
    path.join(tmpDir, 'auth', 'login.meta.json'),
    JSON.stringify(
      {
        pre_request_script: `pm.environment.set('trace_id', 'trc_' + Date.now());`,
        post_response_script: `
          pm.test("Status is 200", function() {
            pm.expect(pm.response.code).to.equal(200);
          });
        `,
        tests: [{ id: '1', name: 'Status is 200', script: '' }],
      },
      null,
      2
    )
  );

  fs.mkdirSync(path.join(tmpDir, 'users'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'users', 'get_profile.curl'),
    `# @name Get User Profile
curl -X GET "{{base_url}}/api/profile" \\
  -H "Authorization: Bearer {{token}}"
`
  );

  // 2. Setup environments
  fs.mkdirSync(path.join(tmpDir, 'environments'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'environments', 'development.env.json'),
    JSON.stringify(
      {
        base_url: 'http://localhost:3000',
        api_key: 'dev_secret_token_123',
        timeout: '5000',
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    path.join(tmpDir, 'environments', 'production.env.json'),
    JSON.stringify(
      {
        base_url: 'https://api.example.com',
        auth_token: 'prod_jwt_super_secret',
      },
      null,
      2
    )
  );

  // 3. Setup secrets in .apiclient/.secrets.json
  fs.mkdirSync(path.join(tmpDir, '.apiclient'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, '.apiclient', '.secrets.json'),
    JSON.stringify(
      {
        api_secret: 'vault_super_secret_42',
      },
      null,
      2
    )
  );

  return tmpDir;
}

test('MCP Protocol: initialize handshake and ping', async () => {
  const tmpDir = createTempWorkspace();
  const server = new McpServer(tmpDir);

  try {
    // 1. initialize request
    const initReq = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0' },
      },
    };

    const resStr = await server.handleMessage(JSON.stringify(initReq));
    assert.ok(resStr);
    const res = JSON.parse(resStr);

    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 1);
    assert.equal(res.result.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.equal(res.result.serverInfo.name, SERVER_NAME);
    assert.ok(res.result.capabilities.tools);
    assert.ok(res.result.capabilities.resources);

    // 2. notifications/initialized (no response expected)
    const initNotif = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    };
    const notifRes = await server.handleMessage(JSON.stringify(initNotif));
    assert.equal(notifRes, null);

    // 3. ping
    const pingReq = {
      jsonrpc: '2.0',
      id: 2,
      method: 'ping',
    };
    const pingResStr = await server.handleMessage(JSON.stringify(pingReq));
    assert.ok(pingResStr);
    const pingRes = JSON.parse(pingResStr);
    assert.equal(pingRes.id, 2);
    assert.deepEqual(pingRes.result, {});
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Protocol: tools/list returns complete 6 tools with schemas', async () => {
  const tmpDir = createTempWorkspace();
  const server = new McpServer(tmpDir);

  try {
    const req = {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/list',
    };

    const resStr = await server.handleMessage(JSON.stringify(req));
    assert.ok(resStr);
    const res = JSON.parse(resStr);

    const tools: any[] = res.result.tools;
    assert.equal(tools.length, 6);

    const toolNames = tools.map((t) => t.name);
    assert.ok(toolNames.includes('list_requests'));
    assert.ok(toolNames.includes('get_request'));
    assert.ok(toolNames.includes('execute_request'));
    assert.ok(toolNames.includes('execute_quick_curl'));
    assert.ok(toolNames.includes('save_request'));
    assert.ok(toolNames.includes('list_environments'));

    // Check schema for execute_request
    const execTool = tools.find((t) => t.name === 'execute_request');
    assert.ok(execTool.description.length > 10);
    assert.deepEqual(execTool.inputSchema.required, ['path']);
    assert.ok(execTool.inputSchema.properties.path);
    assert.ok(execTool.inputSchema.properties.environment);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Tool: list_requests discovers requests and filters by subfolder', async () => {
  const tmpDir = createTempWorkspace();
  const server = new McpServer(tmpDir);

  try {
    // 1. List all requests
    const reqAll = {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'list_requests',
        arguments: {},
      },
    };

    const resStrAll = await server.handleMessage(JSON.stringify(reqAll));
    assert.ok(resStrAll);
    const parsed = JSON.parse(JSON.parse(resStrAll).result.content[0].text);

    assert.equal(parsed.total, 2);
    const paths = parsed.requests.map((r: any) => r.path);
    assert.ok(paths.includes('auth/login.curl'));
    assert.ok(paths.includes('users/get_profile.curl'));

    const loginReq = parsed.requests.find((r: any) => r.path === 'auth/login.curl');
    assert.equal(loginReq.name, 'User Login');
    assert.equal(loginReq.description, 'Authenticates user and returns JWT token');
    assert.equal(loginReq.method, 'POST');

    // 2. Filter to subfolder 'auth'
    const reqAuth = {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'list_requests',
        arguments: { folder: 'auth' },
      },
    };

    const resStrAuth = await server.handleMessage(JSON.stringify(reqAuth));
    assert.ok(resStrAuth);
    const parsedAuth = JSON.parse(JSON.parse(resStrAuth).result.content[0].text);
    assert.equal(parsedAuth.total, 1);
    assert.equal(parsedAuth.requests[0].path, 'auth/login.curl');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Tool: get_request reads directives, method, and sidecar', async () => {
  const tmpDir = createTempWorkspace();
  const server = new McpServer(tmpDir);

  try {
    const req = {
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: {
        name: 'get_request',
        arguments: { path: 'auth/login.curl' },
      },
    };

    const resStr = await server.handleMessage(JSON.stringify(req));
    assert.ok(resStr);
    const details = JSON.parse(JSON.parse(resStr).result.content[0].text);

    assert.equal(details.path, 'auth/login.curl');
    assert.equal(details.name, 'User Login');
    assert.equal(details.method, 'POST');
    assert.ok(details.endpoint.includes('{{base_url}}/api/login'));
    assert.ok(details.rawContent.includes('curl -X POST'));
    assert.ok(details.sidecar);
    assert.ok(details.sidecar.pre_request_script.includes('trace_id'));
    assert.ok(details.sidecar.post_response_script.includes('pm.expect(pm.response.code)'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Tool: save_request creates new .curl file and sidecar', async () => {
  const tmpDir = createTempWorkspace();
  const server = new McpServer(tmpDir);

  try {
    const req = {
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: {
        name: 'save_request',
        arguments: {
          path: 'orders/create_order.curl',
          name: 'Create Order',
          description: 'Submits a new order to the system',
          content: `curl -X POST "{{base_url}}/orders" -H "Content-Type: application/json" -d '{"item_id": "item_123", "qty": 2}'`,
          sidecar: {
            post_response_script: 'pm.test("Created", () => pm.response.to.have.status(201));',
          },
        },
      },
    };

    const resStr = await server.handleMessage(JSON.stringify(req));
    assert.ok(resStr);
    const saveResult = JSON.parse(JSON.parse(resStr).result.content[0].text);
    assert.equal(saveResult.success, true);
    assert.equal(saveResult.savedPath, 'orders/create_order.curl');

    // Verify on disk
    const onDiskFile = path.join(tmpDir, 'orders', 'create_order.curl');
    assert.ok(fs.existsSync(onDiskFile));
    const content = fs.readFileSync(onDiskFile, 'utf-8');
    assert.ok(content.includes('# @name Create Order'));
    assert.ok(content.includes('# @description Submits a new order to the system'));
    assert.ok(content.includes('curl -X POST'));

    const onDiskMeta = path.join(tmpDir, 'orders', 'create_order.meta.json');
    assert.ok(fs.existsSync(onDiskMeta));
    const meta = JSON.parse(fs.readFileSync(onDiskMeta, 'utf-8'));
    assert.ok(meta.post_response_script.includes('pm.test("Created"'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Tool: list_environments masks secret tokens', async () => {
  const tmpDir = createTempWorkspace();
  const server = new McpServer(tmpDir);

  try {
    const req = {
      jsonrpc: '2.0',
      id: 50,
      method: 'tools/call',
      params: {
        name: 'list_environments',
        arguments: {},
      },
    };

    const resStr = await server.handleMessage(JSON.stringify(req));
    assert.ok(resStr);
    const envResult = JSON.parse(JSON.parse(resStr).result.content[0].text);

    assert.equal(envResult.total, 2);
    const dev = envResult.environments.find((e: any) => e.name === 'development');
    assert.ok(dev);
    assert.equal(dev.variables.base_url, 'http://localhost:3000');
    assert.equal(dev.variables.timeout, '5000');
    // Secret keys should be masked with '***'
    assert.equal(dev.variables.api_key, '***');

    const prod = envResult.environments.find((e: any) => e.name === 'production');
    assert.ok(prod);
    assert.equal(prod.variables.auth_token, '***');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Tool: execute_quick_curl and execute_request against HTTP handler', async () => {
  const tmpDir = createTempWorkspace();

  let receivedUrl = '';
  let receivedBody = '';
  let receivedHeaders: Record<string, string> = {};

  const mockFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    receivedUrl = input.toString();
    receivedBody = init?.body ? String(init.body) : '';
    receivedHeaders = (init?.headers as Record<string, string>) || {};

    const headers = new Headers({
      'content-type': 'application/json',
      'x-server-name': 'Mock-Test-Server',
    });

    return new Response(JSON.stringify({ success: true, echo: receivedBody, url: receivedUrl }), {
      status: 200,
      statusText: 'OK',
      headers,
    });
  };

  const server = new McpServer(tmpDir, mockFetch);

  try {
    // 1. Test execute_quick_curl
    const quickReq = {
      jsonrpc: '2.0',
      id: 60,
      method: 'tools/call',
      params: {
        name: 'execute_quick_curl',
        arguments: {
          curl_command: `curl -X POST "http://127.0.0.1:3000/quick" -H "Content-Type: application/json" -d '{"ping":"pong"}'`,
        },
      },
    };

    const quickResStr = await server.handleMessage(JSON.stringify(quickReq));
    assert.ok(quickResStr);
    const quickResult = JSON.parse(JSON.parse(quickResStr).result.content[0].text);

    assert.equal(quickResult.status, 200);
    assert.equal(quickResult.isJson, true);
    assert.equal(quickResult.parsedJson.success, true);
    assert.ok(quickResult.parsedJson.url.includes('/quick'));
    assert.equal(quickResult.headers['x-server-name'], 'Mock-Test-Server');
    assert.ok(quickResult.durationMs >= 0);

    // 2. Test execute_request with saved file and variable resolution (including secret injection & post-response script)
    fs.writeFileSync(
      path.join(tmpDir, 'auth', 'login.curl'),
      `# @name User Login
curl -X POST "http://127.0.0.1:3000/api/login" \\
  -H "Content-Type: application/json" \\
  -d '{"username": "tester", "secret": "{{api_secret}}"}'
`
    );

    const execReq = {
      jsonrpc: '2.0',
      id: 61,
      method: 'tools/call',
      params: {
        name: 'execute_request',
        arguments: {
          path: 'auth/login.curl',
          environment: 'development',
        },
      },
    };

    const execResStr = await server.handleMessage(JSON.stringify(execReq));
    assert.ok(execResStr);
    const execResult = JSON.parse(JSON.parse(execResStr).result.content[0].text);

    assert.equal(execResult.status, 200);
    assert.equal(execResult.isJson, true);
    // Secret was resolved from .apiclient/.secrets.json!
    assert.ok(receivedBody.includes('vault_super_secret_42'));

    // Post-response test assertions should pass!
    assert.equal(execResult.tests.length, 1);
    assert.equal(execResult.tests[0].name, 'Status is 200');
    assert.equal(execResult.tests[0].passed, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Protocol: error handling for malformed JSON, unknown methods, and path traversal', async () => {
  const tmpDir = createTempWorkspace();
  const server = new McpServer(tmpDir);

  try {
    // 1. Malformed JSON
    const malformedRes = await server.handleMessage('{ bad json');
    assert.ok(malformedRes);
    const parsed1 = JSON.parse(malformedRes);
    assert.equal(parsed1.error.code, JsonRpcErrorCode.PARSE_ERROR);

    // 2. Unknown method
    const unknownMethodReq = {
      jsonrpc: '2.0',
      id: 99,
      method: 'non_existent_method',
    };
    const unknownRes = await server.handleMessage(JSON.stringify(unknownMethodReq));
    assert.ok(unknownRes);
    const parsed2 = JSON.parse(unknownRes);
    assert.equal(parsed2.error.code, JsonRpcErrorCode.METHOD_NOT_FOUND);

    // 3. Path traversal attack attempt
    const traversalReq = {
      jsonrpc: '2.0',
      id: 100,
      method: 'tools/call',
      params: {
        name: 'get_request',
        arguments: { path: '../../../../etc/passwd' },
      },
    };
    const traversalRes = await server.handleMessage(JSON.stringify(traversalReq));
    assert.ok(traversalRes);
    const parsed3 = JSON.parse(traversalRes);
    assert.equal(parsed3.result.isError, true);
    assert.ok(parsed3.result.content[0].text.includes('escapes workspace root'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
