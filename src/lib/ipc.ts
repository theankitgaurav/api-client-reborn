import type {
  EnvironmentItem,
  FileDetails,
  ParsedCurlRequest,
  ResponseChunk,
  WorkspaceFileItem,
} from './types';

// Detect whether running in Tauri desktop environment
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function scanWorkspace(path: string): Promise<WorkspaceFileItem[]> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('scan_workspace', { workspacePath: path });
  }

  // Browser mock fallback
  return [
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
      ],
    },
  ];
}

export async function readRequestFile(path: string): Promise<FileDetails> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('read_request_file', { filePath: path });
  }

  // Browser mock fallback
  if (path.includes('create_user')) {
    return {
      path,
      raw_content: `# @name Create User Profile\n# @timeout 15000\n\ncurl -X POST "https://httpbin.org/post" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer {{auth_token}}" \\\n  -d '{\n    "username": "alex",\n    "email": "alex@example.com",\n    "trace_id": "{{$uuid}}"\n  }'`,
      metadata: {
        name: 'Create User Profile',
        timeout_ms: 15000,
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
  console.log('[Dev Mock] Saved file to', path, rawContent);
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
        onChunk({
          type: 'BodyChunk',
          payload: {
            text: JSON.stringify(
              {
                args: { limit: '20', page: '1' },
                headers: {
                  Accept: 'application/json',
                  Host: 'httpbin.org',
                  'X-Trace-Id': '3fa85f64-5717-4562-b3fc-2c963f66afa6',
                },
                origin: '127.0.0.1',
                url: 'https://httpbin.org/get?page=1&limit=20',
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

  return [
    {
      name: 'development',
      file_path: '/environments/development.env.json',
      variables: [
        ['api_host', 'httpbin.org'],
        ['port', '443'],
      ],
    },
    {
      name: 'production',
      file_path: '/environments/production.env.json',
      variables: [
        ['api_host', 'api.production.com'],
        ['port', '443'],
      ],
    },
  ];
}

export async function getWorkspaceSecrets(
  workspacePath: string
): Promise<Record<string, string>> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('get_workspace_secrets', { workspacePath });
  }

  return {
    auth_token: 'secret_dev_token_88419',
    api_key: 'prod_master_key_99312',
  };
}

export async function saveWorkspaceSecrets(
  workspacePath: string,
  secrets: Record<string, string>
): Promise<void> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('save_workspace_secrets', { workspacePath, secrets });
  }
  console.log('[Dev Mock] Saved secrets', secrets);
}
