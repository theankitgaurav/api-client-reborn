/**
 * Model Context Protocol (MCP) JSON-RPC 2.0 framing and data types.
 * Compliant with MCP Protocol Version 2024-11-05.
 */

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const SERVER_NAME = 'api-client-reborn-mcp';
export const SERVER_VERSION = '0.7.0';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, any>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: JsonRpcError;
}

export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export interface McpToolInputSchema {
  type: 'object';
  properties?: Record<string, {
    type: string;
    description?: string;
    items?: Record<string, any>;
    enum?: string[];
    default?: any;
  }>;
  required?: string[];
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: McpToolInputSchema;
}

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpCallResult {
  content: McpTextContent[];
  isError?: boolean;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContents {
  uri: string;
  mimeType?: string;
  text: string;
}

export function createSuccessResponse(id: string | number | null, result: any): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

export function createErrorResponse(id: string | number | null, code: number, message: string, data?: any): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  };
}
