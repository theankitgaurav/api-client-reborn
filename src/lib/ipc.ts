import type {
  EnvironmentItem,
  CollectionVariablesPayload,
  FileDetails,
  GrpcRequestConfig,
  GrpcServiceInfo,
  ParsedCurlRequest,
  RequestHistoryEntry,
  ResponseChunk,
  WorkspaceFileItem,
} from './types';
import { parseGrpcRequest } from './utils/grpc.ts';

// Detect whether running in Tauri desktop environment
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function getWorkspacePath(): Promise<string> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_workspace_path');
  }
  return '~/.api-client-reborn';
}

export async function setWorkspacePath(workspacePath: string): Promise<string> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('set_workspace_path', { workspacePath });
  }
  return workspacePath;
}

export interface WorkspaceHistory {
  default_workspace_path: string;
  recent_workspace_paths: string[];
}

export async function getWorkspaceHistory(): Promise<WorkspaceHistory> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_workspace_history');
  }
  return {
    default_workspace_path: '~/.api-client-reborn/workspace',
    recent_workspace_paths: [],
  };
}

let mockRequestHistory: RequestHistoryEntry[] = [];

export async function getRequestHistory(workspacePath: string): Promise<RequestHistoryEntry[]> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_request_history', { workspacePath });
  }

  return JSON.parse(JSON.stringify(mockRequestHistory));
}

export async function appendRequestHistory(
  workspacePath: string,
  entry: RequestHistoryEntry
): Promise<void> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('append_request_history', { workspacePath, entry });
  }

  mockRequestHistory = [entry, ...mockRequestHistory];
}

export async function clearRequestHistory(workspacePath: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('clear_request_history', { workspacePath });
  }

  mockRequestHistory = [];
}

let mockWorkspaceTree: WorkspaceFileItem[] = [
  {
    name: 'examples',
    path: '/examples',
    is_dir: true,
    children: [
      {
        name: 'get_users.curl',
        path: '/examples/get_users.curl',
        is_dir: false,
        display_name: 'Get All Users',
        method: 'GET',
      },
      {
        name: 'create_user.curl',
        path: '/examples/create_user.curl',
        is_dir: false,
        display_name: 'Create User Profile',
        method: 'POST',
      },
      {
        name: 'stream_events.curl',
        path: '/examples/stream_events.curl',
        is_dir: false,
        display_name: 'Stream Live SSE Events',
        method: 'GET',
      },
      {
        name: 'methods',
        path: '/examples/methods',
        is_dir: true,
        children: [
          {
            name: 'file_upload.curl',
            path: '/examples/methods/file_upload.curl',
            is_dir: false,
            display_name: 'Multipart File Upload',
            method: 'POST',
          },
        ],
      },
      {
        name: 'responses',
        path: '/examples/responses',
        is_dir: true,
        children: [
          {
            name: 'download_file.curl',
            path: '/examples/responses/download_file.curl',
            is_dir: false,
            display_name: 'Download File Response',
            method: 'GET',
          },
        ],
      },
      {
        name: 'variable-resolution',
        path: '/examples/variable-resolution',
        is_dir: true,
        children: [
          {
            name: 'collection-override.curl',
            path: '/examples/variable-resolution/collection-override.curl',
            is_dir: false,
            display_name: 'Variable Resolution - Collection Override',
            method: 'GET',
          },
        ],
      },
    ],
  },
];

const mockFileContents = new Map<string, FileDetails>();

function normalizeMockPath(p: string): string {
  return p.replace(/^[\\\/]+/, '').replace(/[\\\/]+$/, '');
}

function findMockItem(items: WorkspaceFileItem[], targetPath: string): WorkspaceFileItem | null {
  const normTarget = normalizeMockPath(targetPath);
  for (const item of items) {
    if (item.path === targetPath || normalizeMockPath(item.path) === normTarget) {
      return item;
    }
    if (item.children) {
      const found = findMockItem(item.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

function upsertItemInMockTree(path: string, rawContent: string, sidecar?: any) {
  const existing = findMockItem(mockWorkspaceTree, path);
  const isGrpc = /\.(?:grpcurl|grpc)$/i.test(path);
  const nameMatch = rawContent.match(/^[ \t]*#[ \t]*@name\b[ \t]*(.*)$/m);
  let grpcRequest: Partial<GrpcRequestConfig> = {};
  if (isGrpc) {
    grpcRequest = parseGrpcRequest(rawContent);
  }
  const displayName = isGrpc
    ? (nameMatch ? nameMatch[1].trim() : grpcRequest.name)
    : sidecar?.name || (nameMatch ? nameMatch[1].trim() : undefined);

  let method = isGrpc ? (grpcRequest.service && grpcRequest.method ? `${grpcRequest.service}/${grpcRequest.method}` : 'gRPC') : 'GET';
  const methodMatch = rawContent.match(/curl\s+.*?-X\s+([A-Z]+)/i);
  if (methodMatch) {
    method = methodMatch[1].toUpperCase();
  }

  if (existing) {
    if (displayName) existing.display_name = displayName;
    existing.method = method;
    existing.kind = isGrpc ? 'grpc' : 'http';
    return;
  }

  const lastSlash = path.lastIndexOf('/');
  const dir = lastSlash >= 0 ? path.substring(0, lastSlash) : '';
  const fileName = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;

  const newItem: WorkspaceFileItem = {
    name: fileName,
    path,
    is_dir: false,
    display_name: displayName || fileName.replace(/\.(?:curl|grpc|grpcurl)$/i, ''),
    method,
    kind: isGrpc ? 'grpc' : 'http',
  };

  if (!dir || dir === '.' || dir === '/') {
    mockWorkspaceTree.push(newItem);
  } else {
    const parentFolder = findMockItem(mockWorkspaceTree, dir);
    if (parentFolder) {
      if (!parentFolder.children) parentFolder.children = [];
      parentFolder.children.push(newItem);
    } else {
      mockWorkspaceTree.push(newItem);
    }
  }
}

export async function scanWorkspace(path: string): Promise<WorkspaceFileItem[]> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('scan_workspace', { workspacePath: path });
  }

  // Browser mock fallback
  return JSON.parse(JSON.stringify(mockWorkspaceTree));
}

export async function readRequestFile(path: string): Promise<FileDetails> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('read_request_file', { filePath: path });
  }

  // Browser mock fallback
  if (mockFileContents.has(path)) {
    return JSON.parse(JSON.stringify(mockFileContents.get(path)!));
  }
  const normPath = normalizeMockPath(path);
  for (const [storedPath, details] of mockFileContents.entries()) {
    if (normalizeMockPath(storedPath) === normPath) {
      return JSON.parse(JSON.stringify(details));
    }
  }

  if (path.includes('create_user')) {
    return {
      path,
      raw_content: `# @name Create User Profile\n# @timeout 15000\n\ncurl -X POST "https://httpbin.org/post" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer {{auth_token}}" \\\n  -d '{\n    "username": "alex",\n    "email": "alex@example.com",\n    "trace_id": "{{$uuid}}"\n  }'`,
      metadata: {
        name: 'Create User Profile',
        timeout_ms: 15000,
      },
    };
  } else if (path.includes('collection-override')) {
    return {
      path,
      raw_content: `# @name Variable Resolution - Collection Override\n# @description Sends collection and environment values to httpbin so you can inspect the winning source.\n# @timeout 30000\n\ncurl -X GET "https://httpbin.org/anything?scope_probe={{scope_probe}}&secret_probe={{secret_probe}}" \\\n  -H "Accept: application/json"`,
      metadata: {
        name: 'Variable Resolution - Collection Override',
        description: 'Sends collection and environment values to httpbin so you can inspect the winning source.',
        timeout_ms: 30000,
      },
    };
  } else if (path.includes('download_file')) {
    return {
      path,
      raw_content: `# @name Download File Response\n# @description Requests an attachment response from httpbin. After sending, use Save in the response Body panel to download the response as httpbin-download.json.\n# @timeout 30000\n\ncurl -X GET "https://httpbin.org/response-headers?Content-Disposition=attachment%3B%20filename%3Dhttpbin-download.json" \\\n  -H "Accept: application/json"`,
      metadata: {
        name: 'Download File Response',
        timeout_ms: 30000,
      },
    };
  } else if (path.includes('file_upload')) {
    return {
      path,
      raw_content: `# @name Multipart File Upload\n# @description Uploads a selected local file and a text field to httpbin. In Body, click Choose file for the attachment field, select a file, then send. The response echoes the uploaded file details.\n# @timeout 30000\n\ncurl -X POST "https://httpbin.org/post" \\\n  -F 'note=Uploaded from API Client Reborn' \\\n  -F 'attachment=@'`,
      metadata: {
        name: 'Multipart File Upload',
        timeout_ms: 30000,
      },
    };
  } else if (path.includes('stream_events')) {
    return {
      path,
      raw_content: `# @name Stream Live SSE Events\n# @timeout 60000\n\ncurl -N "https://httpbin.org/stream/15" \\\n  -H "Accept: text/event-stream"`,
      metadata: {
        name: 'Stream Live SSE Events',
        timeout_ms: 60000,
      },
    };
  }

  return {
    path,
    raw_content: `# @name Get All Users\n# @description List registered users with pagination\n# @timeout 30000\n\ncurl -X GET "https://httpbin.org/get?page=1&limit=20" \\\n  -H "Accept: application/json" \\\n  -H "X-Trace-Id: {{$uuid}}"`,
    metadata: {
      name: 'Get All Users',
      description: 'List registered users with pagination',
      timeout_ms: 30000,
    },
  };
}

export async function saveRequestFile(
  path: string,
  rawContent: string,
  sidecar?: any
): Promise<void> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('save_request_file', {
      filePath: path,
      rawContent,
      sidecar,
    });
  }

  const nameMatch = rawContent.match(/^[ \t]*#[ \t]*@name\b[ \t]*(.*)$/m);
  const inferredName = nameMatch ? nameMatch[1].trim() : undefined;
  mockFileContents.set(path, {
    path,
    raw_content: rawContent,
    metadata: {
      name: sidecar?.name || inferredName,
    },
    sidecar,
  });

  upsertItemInMockTree(path, rawContent, sidecar);
}

export async function parseCurlPreview(rawContent: string): Promise<ParsedCurlRequest> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('parse_curl_preview', { rawContent });
  }

  return {
    method: 'GET',
    url: 'https://httpbin.org/get',
    headers: [{ key: 'Accept', value: 'application/json' }],
    follow_redirects: true,
    insecure: false,
    unsupported_flags: [],
  };
}

export async function executeRequest(
  requestId: string,
  rawContent: string,
  variables: Record<string, string>,
  onChunk: (chunk: ResponseChunk) => void
): Promise<void> {
  if (isTauri) {
    const { invoke, Channel } = await import('@tauri-apps/api/core');
    const channel = new Channel<ResponseChunk>();
    channel.onmessage = onChunk;

    return invoke('execute_request', {
      requestId,
      rawContent,
      variables,
      channel,
    });
  }

  // Browser mock simulation
  onChunk({ type: 'Started', payload: { request_id: requestId } });

  setTimeout(() => {
    onChunk({
      type: 'HeaderReceived',
      payload: {
        status: 200,
        status_text: 'OK',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Server', value: 'gunicorn/19.9.0' },
          { key: 'Date', value: new Date().toUTCString() },
        ],
        protocol: 'HTTP/2.0',
        ttfb_ms: 84,
        is_streaming: rawContent.includes('-N') || rawContent.includes('stream'),
      },
    });

    if (rawContent.includes('stream')) {
      // Simulate SSE streaming chunks
      let count = 0;
      const interval = setInterval(() => {
        count++;
        onChunk({
          type: 'SseChunk',
          payload: {
            id: `msg-${count}`,
            event: 'update',
            data: JSON.stringify({ index: count, timestamp: Date.now() }),
          },
        });

        if (count >= 5) {
          clearInterval(interval);
          onChunk({
            type: 'Finished',
            payload: {
              total_duration_ms: 1200,
              total_bytes: 420,
            },
          });
        }
      }, 200);
    } else {
      setTimeout(() => {
        let echoedArgs: Record<string, string> = { limit: '20', page: '1' };
        let resolvedUrl = 'https://httpbin.org/get?page=1&limit=20';
        const urlMatch = rawContent.match(/https?:\/\/[^\s"']+/);
        if (urlMatch) {
          let u = urlMatch[0];
          for (const [k, v] of Object.entries(variables)) {
            u = u.replaceAll(`{{${k}}}`, v);
          }
          resolvedUrl = u;
          try {
            const parsedUrl = new URL(u);
            const queryArgs: Record<string, string> = {};
            parsedUrl.searchParams.forEach((v, k) => { queryArgs[k] = v; });
            if (Object.keys(queryArgs).length > 0) echoedArgs = queryArgs;
          } catch {}
        }

        onChunk({
          type: 'BodyChunk',
          payload: {
            text: JSON.stringify(
              {
                args: echoedArgs,
                headers: {
                  Accept: 'application/json',
                  Host: 'httpbin.org',
                  'X-Trace-Id': '3fa85f64-5717-4562-b3fc-2c963f66afa6',
                },
                origin: '127.0.0.1',
                url: resolvedUrl,
              },
              null,
              2
            ),
            bytes_received: 312,
          },
        });

        onChunk({
          type: 'Finished',
          payload: {
            total_duration_ms: 124,
            total_bytes: 312,
          },
        });
      }, 100);
    }
  }, 120);
}

export async function discoverGrpcServices(config: GrpcRequestConfig, workspacePath: string): Promise<GrpcServiceInfo[]> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('discover_grpc_services', { config, workspacePath });
  }
  return [];
}

export async function executeGrpcRequest(
  requestId: string,
  config: GrpcRequestConfig,
  workspacePath: string,
  onChunk: (chunk: ResponseChunk) => void
): Promise<void> {
  if (isTauri) {
    const { invoke, Channel } = await import('@tauri-apps/api/core');
    const channel = new Channel<ResponseChunk>();
    channel.onmessage = onChunk;
    return invoke('execute_grpc_request', {
      requestId,
      config,
      workspacePath,
      channel,
    });
  }

  onChunk({ type: 'Started', payload: { request_id: requestId } });
  onChunk({
    type: 'HeaderReceived',
    payload: { status: 200, status_text: 'gRPC', headers: [], protocol: 'gRPC/HTTP2', ttfb_ms: 1, is_streaming: false },
  });
  setTimeout(() => {
    onChunk({ type: 'BodyChunk', payload: { text: `// Dev preview for ${config.service}/${config.method}`, bytes_received: 0 } });
    onChunk({ type: 'Finished', payload: { total_duration_ms: 1, total_bytes: 0 } });
  }, 0);
}

export async function cancelRequest(requestId: string): Promise<boolean> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('cancel_request', { requestId });
  }
  return true;
}

export async function getWorkspaceEnvironments(
  workspacePath: string
): Promise<EnvironmentItem[]> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_workspace_environments', { workspacePath });
  }

  return JSON.parse(JSON.stringify(mockEnvironments));
}

export async function saveWorkspaceEnvironment(
  workspacePath: string,
  environmentName: string,
  publicVars: Record<string, string>,
  secretVars: Record<string, string>
): Promise<void> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('save_workspace_environment', {
      workspacePath,
      environmentName,
      publicVars,
      secretVars,
    });
  }
  mockEnvironments = mockEnvironments.filter((environment) => environment.name !== environmentName);
  mockEnvironments.push({
    name: environmentName,
    file_path: `/environments/${environmentName}.env.json`,
    variables: Object.entries(publicVars),
    secret_variables: Object.entries(secretVars),
  });
}

let mockEnvironments: EnvironmentItem[] = [
  { name: 'default', file_path: '/environments/default.env.json', variables: [['base_url', 'https://httpbin.org']] },
  { name: 'development', file_path: '/environments/development.env.json', variables: [['api_host', 'httpbin.org'], ['port', '443']] },
  { name: 'production', file_path: '/environments/production.env.json', variables: [['api_host', 'api.production.com'], ['port', '443']] },
];
let mockWorkspaceSecrets: Record<string, string> = {
  auth_token: 'secret_dev_token_88419',
  api_key: 'prod_master_key_99312',
};

export async function getCollectionVariables(requestFilePath: string): Promise<Record<string, string>> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_collection_variables', { requestFilePath });
  }
  const detail = await getCollectionVariablesForEditor(requestFilePath);
  return detail ? { ...detail.public_vars, ...detail.secret_vars } : {};
}

const mockCollectionVariableSets = new Map<string, CollectionVariablesPayload>();

function mockCollectionKey(requestFilePath: string): string {
  const normalized = requestFilePath.replaceAll('\\', '/');
  if (normalized.includes('/variable-resolution/')) return '/examples/variable-resolution';
  const parent = normalized.slice(0, normalized.lastIndexOf('/'));
  return parent || '/';
}

export async function getCollectionVariablesForEditor(
  requestFilePath: string
): Promise<CollectionVariablesPayload | null> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_collection_variables_for_editor', { requestFilePath });
  }
  const key = mockCollectionKey(requestFilePath);
  if (!mockCollectionVariableSets.has(key) && key === '/examples/variable-resolution') {
    mockCollectionVariableSets.set(key, {
      collection_name: 'variable-resolution',
      public_vars: { scope_probe: 'from-collection' },
      secret_vars: {},
    });
  }
  return mockCollectionVariableSets.get(key) || null;
}

export async function saveCollectionVariables(
  requestFilePath: string,
  publicVars: Record<string, string>,
  secretVars: Record<string, string>
): Promise<void> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('save_collection_variables', { requestFilePath, publicVars, secretVars });
  }
  const key = mockCollectionKey(requestFilePath);
  const existing = await getCollectionVariablesForEditor(requestFilePath);
  const pathParts = key.split('/').filter(Boolean);
  mockCollectionVariableSets.set(key, {
    collection_name: existing?.collection_name || pathParts[pathParts.length - 1] || 'Collection',
    public_vars: { ...publicVars },
    secret_vars: { ...secretVars },
  });
}

export async function getWorkspaceSecrets(
  workspacePath: string
): Promise<Record<string, string>> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_workspace_secrets', { workspacePath });
  }

  return { ...mockWorkspaceSecrets };
}

export async function saveWorkspaceSecrets(
  workspacePath: string,
  secrets: Record<string, string>
): Promise<void> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('save_workspace_secrets', { workspacePath, secrets });
  }
  mockWorkspaceSecrets = { ...secrets };
}

export async function getWorkspaceVariables(
  workspacePath: string
): Promise<{ public_vars: Record<string, string>; secret_vars: Record<string, string> }> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_workspace_variables', { workspacePath });
  }

  return {
    public_vars: {
      api_host: 'httpbin.org',
      base_url: 'https://httpbin.org',
      port: '443',
    },
    secret_vars: {
      auth_token: 'secret_dev_token_88419',
      api_key: 'sk_local_testing_secret_key_99',
    },
  };
}

export async function saveWorkspaceVariables(
  workspacePath: string,
  publicVars: Record<string, string>,
  secretVars: Record<string, string>
): Promise<void> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('save_workspace_variables', {
      workspacePath,
      publicVars,
      secretVars,
    });
  }
  console.log('[Dev Mock] Saved variables:', { publicVars, secretVars });
}

export async function createCollectionFolder(
  parentPath: string,
  folderName: string
): Promise<string> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('create_collection_folder', { parentPath, folderName });
  }

  const cleanFolderName = folderName.trim().replace(/[\\\/]+/g, '_');
  const isRoot = !parentPath || parentPath === '.' || parentPath === '/' || parentPath === './';
  const newPath = isRoot
    ? cleanFolderName
    : `${parentPath.replace(/[\\\/]+$/, '')}/${cleanFolderName}`;

  const newFolder: WorkspaceFileItem = {
    name: cleanFolderName,
    path: newPath,
    is_dir: true,
    children: [],
  };

  if (isRoot) {
    mockWorkspaceTree.push(newFolder);
  } else {
    const parent = findMockItem(mockWorkspaceTree, parentPath);
    if (parent) {
      if (!parent.children) parent.children = [];
      parent.children.push(newFolder);
    } else {
      mockWorkspaceTree.push(newFolder);
    }
  }

  return newPath;
}

export async function deleteWorkspaceItem(itemPath: string): Promise<void> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('delete_workspace_item', { itemPath });
  }

  function removeFromTree(items: WorkspaceFileItem[]): boolean {
    const normTarget = normalizeMockPath(itemPath);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.path === itemPath || normalizeMockPath(item.path) === normTarget) {
        items.splice(i, 1);
        return true;
      }
      if (item.children && item.children.length > 0) {
        if (removeFromTree(item.children)) {
          return true;
        }
      }
    }
    return false;
  }

  removeFromTree(mockWorkspaceTree);
  mockFileContents.delete(itemPath);
}

export async function renameWorkspaceItem(
  oldPath: string,
  newName: string
): Promise<string> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('rename_workspace_item', { oldPath, newName });
  }

  function updateChildrenPrefix(
    children: WorkspaceFileItem[],
    oldPrefix: string,
    newPrefix: string
  ) {
    for (const child of children) {
      if (child.path.startsWith(oldPrefix + '/')) {
        child.path = newPrefix + child.path.slice(oldPrefix.length);
      } else if (child.path === oldPrefix) {
        child.path = newPrefix;
      }
      if (child.children) {
        updateChildrenPrefix(child.children, oldPrefix, newPrefix);
      }
    }
  }

  function updateInTree(items: WorkspaceFileItem[]): string | null {
    const normOld = normalizeMockPath(oldPath);
    for (const item of items) {
      if (item.path === oldPath || normalizeMockPath(item.path) === normOld) {
        const isGrpcurl = item.name.toLowerCase().endsWith('.grpcurl');
        const isGrpc = item.name.toLowerCase().endsWith('.grpc') || isGrpcurl;
        const isRequest = item.name.endsWith('.curl') || isGrpc;
        if (isRequest) {
          const ext = isGrpcurl ? 'grpcurl' : isGrpc ? 'grpc' : 'curl';
          const trimmed = newName.trim();
          let displayName = trimmed;
          let fileName = trimmed;
          if (trimmed.toLowerCase().endsWith(`.${ext}`)) {
            displayName = trimmed.slice(0, -(ext.length + 1));
          } else {
            const slug =
              trimmed
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '') || 'request';
            fileName = `${slug}.${ext}`;
          }
          const lastSlash = item.path.lastIndexOf('/');
          const parent = lastSlash >= 0 ? item.path.substring(0, lastSlash) : '';
          const newPath = parent ? `${parent}/${fileName}` : fileName;
          item.name = fileName;
          item.display_name = displayName;
          item.path = newPath;

          if (mockFileContents.has(oldPath)) {
            const details = mockFileContents.get(oldPath)!;
            mockFileContents.delete(oldPath);
            details.path = newPath;
            if (details.metadata) details.metadata.name = displayName;
            if (isGrpc) {
              try {
                const grpcConfig = JSON.parse(details.raw_content);
                grpcConfig.name = displayName;
                details.raw_content = JSON.stringify(grpcConfig, null, 2);
              } catch { /* preserve malformed request data */ }
            }
            if (details.sidecar) details.sidecar.name = displayName;
            mockFileContents.set(newPath, details);
          }

          return newPath;
        } else {
          const trimmed = newName.trim();
          const lastSlash = item.path.lastIndexOf('/');
          const parent = lastSlash >= 0 ? item.path.substring(0, lastSlash) : '';
          const newPath = parent ? `${parent}/${trimmed}` : trimmed;
          const oldItemPath = item.path;
          item.name = trimmed;
          item.path = newPath;
          if (item.children) {
            updateChildrenPrefix(item.children, oldItemPath, newPath);
          }
          return newPath;
        }
      }
      if (item.children) {
        const res = updateInTree(item.children);
        if (res) return res;
      }
    }
    return null;
  }

  const updatedPath = updateInTree(mockWorkspaceTree);
  return updatedPath || newName;
}

export async function duplicateRequestFile(sourcePath: string): Promise<string> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('duplicate_request_file', { sourcePath });
  }

  const isGrpcurl = sourcePath.toLowerCase().endsWith('.grpcurl');
  const isGrpc = sourcePath.toLowerCase().endsWith('.grpc') || isGrpcurl;
  const ext = isGrpcurl ? 'grpcurl' : isGrpc ? 'grpc' : 'curl';
  const lastSlash = sourcePath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? sourcePath.substring(0, lastSlash) : '';
  const fileBasename = lastSlash >= 0 ? sourcePath.substring(lastSlash + 1) : sourcePath;
  const stem = fileBasename.replace(/\.(?:curl|grpc|grpcurl)$/i, '');

  function getSiblingNames(items: WorkspaceFileItem[], targetPath: string): string[] {
    const normTarget = normalizeMockPath(targetPath);
    for (const item of items) {
      if (item.path === targetPath || normalizeMockPath(item.path) === normTarget) {
        return items.map((i) => i.name);
      }
      if (item.children) {
        const found = getSiblingNames(item.children, targetPath);
        if (found.length > 0) return found;
      }
    }
    return [];
  }

  const siblingNames = new Set(getSiblingNames(mockWorkspaceTree, sourcePath));

  let candidateName = `${stem}_copy.${ext}`;
  let counter = 2;
  while (siblingNames.has(candidateName)) {
    candidateName = `${stem}_copy_${counter}.${ext}`;
    counter++;
  }

  const newPath = dir ? `${dir}/${candidateName}` : candidateName;

  const originalItem = findMockItem(mockWorkspaceTree, sourcePath);
  const originalDisplay = originalItem?.display_name || stem;
  const newDisplay = `${originalDisplay} (Copy)`;

  const duplicateItem: WorkspaceFileItem = {
    name: candidateName,
    path: newPath,
    is_dir: false,
    display_name: newDisplay,
    method: originalItem?.method || 'GET',
    kind: ext === 'grpc' ? 'grpc' : 'http',
  };

  function insertDuplicate(items: WorkspaceFileItem[]): boolean {
    const normTarget = normalizeMockPath(sourcePath);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.path === sourcePath || normalizeMockPath(item.path) === normTarget) {
        items.splice(i + 1, 0, duplicateItem);
        return true;
      }
      if (item.children && item.children.length > 0) {
        if (insertDuplicate(item.children)) {
          return true;
        }
      }
    }
    return false;
  }

  if (!insertDuplicate(mockWorkspaceTree)) {
    mockWorkspaceTree.push(duplicateItem);
  }

  try {
    const originalContent = await readRequestFile(sourcePath);
    let rawContent = originalContent.raw_content;
    if (ext === 'grpc') {
      const grpcConfig = JSON.parse(rawContent);
      grpcConfig.name = newDisplay;
      rawContent = JSON.stringify(grpcConfig, null, 2);
    } else if (rawContent.match(/^[ \t]*#[ \t]*@name\b/m)) {
      rawContent = rawContent.replace(
        /^[ \t]*#[ \t]*@name\b[ \t]*(.*)$/m,
        `# @name ${newDisplay}`
      );
    } else {
      rawContent = `# @name ${newDisplay}\n${rawContent}`;
    }

    const clonedSidecar = originalContent.sidecar
      ? { ...originalContent.sidecar, name: newDisplay }
      : undefined;

    mockFileContents.set(newPath, {
      path: newPath,
      raw_content: rawContent,
      metadata: {
        ...originalContent.metadata,
        name: newDisplay,
      },
      sidecar: clonedSidecar,
    });
  } catch {
    mockFileContents.set(newPath, {
      path: newPath,
      raw_content: `# @name ${newDisplay}\ncurl -X GET "https://httpbin.org/get"`,
      metadata: { name: newDisplay },
    });
  }

  return newPath;
}

export async function importCollectionBundle(
  collectionName: string,
  files: { relative_path: string; content: string; sidecar?: any }[],
  envVars?: [string, string][],
  secretVars?: [string, string][]
): Promise<{ imported_requests: number; env_file?: string }> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('import_collection_bundle', {
      collectionName,
      files,
      envVars,
      secretVars,
    });
  }
  return { imported_requests: files.length, env_file: `.apiclient/collection_variables.json` };
}

export async function exportSpooledStream(
  spoolPath: string,
  destinationPath: string
): Promise<number> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('export_spooled_stream', { spoolPath, destinationPath });
  }
  console.log('[Dev Mock] Exported stream from', spoolPath, 'to', destinationPath);
  return 0;
}

export interface McpConfigInfo {
  workspace_path: string;
  executable_path: string;
}

export async function getMcpConfigInfo(): Promise<McpConfigInfo> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_mcp_config_info');
  }
  return {
    workspace_path: typeof window !== 'undefined' ? (window as any).__MOCK_WORKSPACE__ || '~/.api-client-reborn' : '~/.api-client-reborn',
    executable_path: '/Applications/API Client Reborn.app/Contents/MacOS/api-client-reborn',
  };
}

export async function relaunchApp(): Promise<void> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('relaunch_app');
  }
  console.log('[Dev Mock] Application restart triggered');
}

