import readline from 'node:readline';
import {
  JsonRpcErrorCode,
  MCP_PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
  createErrorResponse,
  createSuccessResponse,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpCallResult,
  type McpResource,
  type McpTool,
} from './protocol.ts';
import { WorkspaceManager } from './workspace.ts';
import { executeHttpRequest } from './executor.ts';

export class McpServer {
  private workspace: WorkspaceManager;
  private fetchFn: typeof fetch;

  constructor(workspacePath?: string, fetchFn: typeof fetch = globalThis.fetch) {
    this.workspace = new WorkspaceManager(workspacePath);
    this.fetchFn = fetchFn;
  }

  public getWorkspacePath(): string {
    return this.workspace.workspaceRoot;
  }

  /**
   * Returns list of tools supported by this MCP server.
   */
  public getTools(): McpTool[] {
    return [
      {
        name: 'list_requests',
        description: 'Lists all .curl, .grpcurl, and .grpc requests in the workspace with method, name, description, and relative path.',
        inputSchema: {
          type: 'object',
          properties: {
            folder: {
              type: 'string',
              description: 'Optional subfolder to restrict search to (e.g. "auth" or "collections/users")',
            },
          },
        },
      },
      {
        name: 'get_request',
        description: 'Reads and inspects a request file (.curl, .grpcurl, or .grpc), including headers, directives, and companion sidecar scripts.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path to request file, e.g. "auth/login.curl"',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'execute_request',
        description: 'Executes a saved .curl request with environment resolution and secret injection. Evaluates pre-request scripts and post-response test assertions.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path to request file, e.g. "users/create_user.curl"',
            },
            environment: {
              type: 'string',
              description: 'Optional environment name (e.g. "development", "production")',
            },
            variables: {
              type: 'object',
              description: 'Optional key-value variable overrides for this execution',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'execute_quick_curl',
        description: 'Executes an ad-hoc raw cURL command against an environment without saving it to disk.',
        inputSchema: {
          type: 'object',
          properties: {
            curl_command: {
              type: 'string',
              description: 'Raw cURL command string, e.g. \'curl -X GET "https://httpbin.org/get" -H "Accept: application/json"\'',
            },
            environment: {
              type: 'string',
              description: 'Optional environment name to resolve any {{variable}} tokens',
            },
            variables: {
              type: 'object',
              description: 'Optional key-value variable overrides',
            },
          },
          required: ['curl_command'],
        },
      },
      {
        name: 'save_request',
        description: 'Creates or updates a .curl, .grpcurl, or .grpc request file and companion sidecar metadata in the workspace repository.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Target relative path, e.g. "collections/users/get_user.curl"',
            },
            content: {
              type: 'string',
              description: 'The raw content of the request file',
            },
            name: {
              type: 'string',
              description: 'Optional display name (updates or appends # @name header)',
            },
            description: {
              type: 'string',
              description: 'Optional description (updates or appends # @description header)',
            },
            sidecar: {
              type: 'object',
              description: 'Optional companion sidecar with pre_request_script, post_response_script, and tests',
            },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'list_environments',
        description: 'Lists all available workspace environments (environments/*.env.json) and non-secret variables.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ];
  }

  /**
   * Returns list of resources exposed by this server.
   */
  public getResources(): McpResource[] {
    return [
      {
        uri: 'workspace://tree',
        name: 'Workspace Requests Tree',
        description: 'Structured index of all HTTP and gRPC requests in the workspace',
        mimeType: 'application/json',
      },
      {
        uri: 'workspace://environments',
        name: 'Workspace Environments',
        description: 'Active environment configurations and non-secret variables',
        mimeType: 'application/json',
      },
    ];
  }

  /**
   * Handles a single incoming JSON-RPC 2.0 message string.
   * Returns response JSON string, or null for notifications.
   */
  public async handleMessage(rawMessage: string): Promise<string | null> {
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(rawMessage);
    } catch {
      return JSON.stringify(
        createErrorResponse(null, JsonRpcErrorCode.PARSE_ERROR, 'Parse error: invalid JSON')
      );
    }

    if (!req || typeof req !== 'object' || req.jsonrpc !== '2.0') {
      return JSON.stringify(
        createErrorResponse(req?.id ?? null, JsonRpcErrorCode.INVALID_REQUEST, 'Invalid JSON-RPC request')
      );
    }

    const { id, method, params } = req;
    const isNotification = id === undefined || id === null;

    try {
      switch (method) {
        case 'initialize': {
          const result = {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {},
              resources: {},
            },
            serverInfo: {
              name: SERVER_NAME,
              version: SERVER_VERSION,
            },
          };
          return JSON.stringify(createSuccessResponse(id, result));
        }

        case 'notifications/initialized': {
          // Notification: no response required
          return null;
        }

        case 'ping': {
          return JSON.stringify(createSuccessResponse(id, {}));
        }

        case 'tools/list': {
          return JSON.stringify(createSuccessResponse(id, { tools: this.getTools() }));
        }

        case 'tools/call': {
          const callResult = await this.callTool(params?.name, params?.arguments || {});
          return JSON.stringify(createSuccessResponse(id, callResult));
        }

        case 'resources/list': {
          return JSON.stringify(createSuccessResponse(id, { resources: this.getResources() }));
        }

        case 'resources/read': {
          const uri = params?.uri;
          if (uri === 'workspace://tree') {
            const requests = this.workspace.listRequests();
            return JSON.stringify(
              createSuccessResponse(id, {
                contents: [
                  {
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(requests, null, 2),
                  },
                ],
              })
            );
          }
          if (uri === 'workspace://environments') {
            const envs = this.workspace.listEnvironments();
            return JSON.stringify(
              createSuccessResponse(id, {
                contents: [
                  {
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(envs, null, 2),
                  },
                ],
              })
            );
          }
          return JSON.stringify(
            createErrorResponse(id, JsonRpcErrorCode.INVALID_PARAMS, `Resource not found: ${uri}`)
          );
        }

        default: {
          if (isNotification) return null;
          return JSON.stringify(
            createErrorResponse(id, JsonRpcErrorCode.METHOD_NOT_FOUND, `Method not found: ${method}`)
          );
        }
      }
    } catch (err: any) {
      if (isNotification) return null;
      return JSON.stringify(
        createErrorResponse(id, JsonRpcErrorCode.INTERNAL_ERROR, err.message || 'Internal server error')
      );
    }
  }

  /**
   * Tool invocation handler.
   */
  private async callTool(toolName: string, args: Record<string, any>): Promise<McpCallResult> {
    try {
      switch (toolName) {
        case 'list_requests': {
          const folder = typeof args.folder === 'string' ? args.folder : '';
          const list = this.workspace.listRequests(folder);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ total: list.length, requests: list }, null, 2),
              },
            ],
          };
        }

        case 'get_request': {
          if (!args.path || typeof args.path !== 'string') {
            return {
              isError: true,
              content: [{ type: 'text', text: "Missing required argument 'path'" }],
            };
          }
          const details = this.workspace.getRequest(args.path);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(details, null, 2),
              },
            ],
          };
        }

        case 'execute_request': {
          if (!args.path || typeof args.path !== 'string') {
            return {
              isError: true,
              content: [{ type: 'text', text: "Missing required argument 'path'" }],
            };
          }

          const request = this.workspace.getRequest(args.path);
          if (request.type === 'grpc') {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: 'Direct gRPC execution via MCP is planned for v1.1. Inspect request via get_request or run via desktop application.',
                },
              ],
            };
          }

          const resolvedVars = this.workspace.resolveVariables(
            args.path,
            args.environment,
            args.variables || {}
          );

          const result = await executeHttpRequest(request, resolvedVars, this.fetchFn);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'execute_quick_curl': {
          if (!args.curl_command || typeof args.curl_command !== 'string') {
            return {
              isError: true,
              content: [{ type: 'text', text: "Missing required argument 'curl_command'" }],
            };
          }

          const resolvedVars = this.workspace.resolveVariables(
            undefined,
            args.environment,
            args.variables || {}
          );

          const result = await executeHttpRequest(
            { rawContent: args.curl_command },
            resolvedVars,
            this.fetchFn
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'save_request': {
          if (!args.path || typeof args.path !== 'string') {
            return {
              isError: true,
              content: [{ type: 'text', text: "Missing required argument 'path'" }],
            };
          }
          if (typeof args.content !== 'string') {
            return {
              isError: true,
              content: [{ type: 'text', text: "Missing required argument 'content'" }],
            };
          }

          const saved = this.workspace.saveRequest(
            args.path,
            args.content,
            args.name,
            args.description,
            args.sidecar
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, savedPath: saved.path }, null, 2),
              },
            ],
          };
        }

        case 'list_environments': {
          const envs = this.workspace.listEnvironments();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ total: envs.length, environments: envs }, null, 2),
              },
            ],
          };
        }

        default: {
          return {
            isError: true,
            content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
          };
        }
      }
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Tool error: ${err.message}` }],
      };
    }
  }

  /**
   * Starts the stdio listening loop.
   */
  public startStdio(
    input: NodeJS.ReadableStream = process.stdin,
    output: NodeJS.WritableStream = process.stdout
  ): void {
    const rl = readline.createInterface({
      input,
      crlfDelay: Infinity,
    });

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const response = await this.handleMessage(trimmed);
      if (response !== null) {
        output.write(response + '\n');
      }
    });

    // Handle clean process shutdown
    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
  }
}
