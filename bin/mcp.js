#!/usr/bin/env node

/**
 * API Client Reborn - Model Context Protocol (MCP) Server CLI.
 * Launches a stdio JSON-RPC 2.0 server for AI coding agents.
 */

import { McpServer } from '../src/mcp/server.ts';
import { SERVER_NAME, SERVER_VERSION } from '../src/mcp/protocol.ts';

function printHelp() {
  console.error(`
${SERVER_NAME} v${SERVER_VERSION}
A native Model Context Protocol (MCP) server for API Client Reborn.

Usage:
  api-client-mcp [options]

Options:
  -w, --workspace <path>   Path to the workspace root directory (default: current directory or ~/.api-client-reborn)
  -v, --version            Display version number
  -h, --help               Display this help message

Configuration Examples:

Claude Desktop (claude_desktop_config.json):
{
  "mcpServers": {
    "api-client-reborn": {
      "command": "node",
      "args": ["--experimental-strip-types", "/path/to/api-client-reborn/bin/mcp.js", "--workspace", "/path/to/project"]
    }
  }
}

Cursor (.cursor/mcp.json):
{
  "mcpServers": {
    "api-client-reborn": {
      "command": "node",
      "args": ["--experimental-strip-types", "${workspaceFolder}/bin/mcp.js", "--workspace", "${workspaceFolder}"]
    }
  }
}
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let workspacePath = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--version' || arg === '-v') {
      console.error(`${SERVER_NAME} v${SERVER_VERSION}`);
      process.exit(0);
    }
    if (arg === '--workspace' || arg === '-w') {
      if (i + 1 < args.length) {
        workspacePath = args[++i];
      }
    }
  }

  return { workspacePath };
}

const { workspacePath } = parseArgs();
const server = new McpServer(workspacePath);

// Log startup info to stderr (leaving stdout clean for JSON-RPC messages)
console.error(`[${SERVER_NAME}] Starting MCP Server (Protocol: 2024-11-05, Version: ${SERVER_VERSION})`);
console.error(`[${SERVER_NAME}] Workspace root: ${server.getWorkspacePath()}`);

server.startStdio();
