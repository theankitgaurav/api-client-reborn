# Model Context Protocol (MCP) Guide for API Client Reborn

The **API Client Reborn MCP Server** exposes your local, Git-versioned API collections and environments to modern AI coding assistants (Claude Desktop, Cursor, Antigravity, VS Code Copilot, Zed).

The MCP server is implemented natively in Rust inside the `api_client_reborn` binary. Users do not need Node.js, `npx`, a repository checkout, or any external runtimes in the workspace.

AI agents can automatically:
1. **Discover & inspect** `.curl`, `.grpcurl`, and `.grpc` requests in your repository.
2. **Execute HTTP requests** (`execute_request`, `execute_quick_curl`) against local or remote environments (`development`, `staging`, `production`).
3. **Execute gRPC requests** (`execute_grpc_request`) supporting reflection, protobuf files, metadata, TLS, unary calls, and client/server streaming.
4. **Run test assertions** headlessly (`pm.test()`, `pm.expect()`) and inspect status codes, headers, and responses.
5. **Safely resolve secrets** from canonical `.apiclient/.secrets.env` (secrets are injected into outgoing requests, but masked in metadata and prompt listings).
6. **Create & update requests** directly as `.curl`, `.grpcurl`, or `.grpc` files when writing new API routes in your code.

---

## 🚀 Quick Setup

The MCP server runs over standard input/output (`stdio`) from the native application binary:

```bash
api_client_reborn mcp --workspace /path/to/your/workspace
```

### 1. Installed Application Configuration

Configure your MCP client to launch the native binary. The workspace path should point to the directory containing your requests and environments.

```json
{
  "mcpServers": {
    "api-client-reborn": {
      "command": "api_client_reborn",
      "args": ["mcp", "--workspace", "/absolute/path/to/your/api-workspace"]
    }
  }
}
```

On macOS, the installed app binary is located at:
`/Applications/API Client Reborn.app/Contents/MacOS/api_client_reborn`

### 2. Claude Desktop

Add the server to your Claude Desktop configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "api-client-reborn": {
      "command": "api_client_reborn",
      "args": [
        "mcp",
        "--workspace",
        "/absolute/path/to/your/api-workspace"
      ]
    }
  }
}
```

---

### 3. Cursor

Add the server to `.cursor/mcp.json` in your repository root:

```json
{
  "mcpServers": {
    "api-client-reborn": {
      "command": "api_client_reborn",
      "args": [
        "mcp",
        "--workspace",
        "${workspaceFolder}"
      ]
    }
  }
}
```

---

### 4. Antigravity / Gemini CLI

Configure in your workspace `.gemini/settings.json` or Antigravity MCP settings:

```json
{
  "mcpServers": {
    "api-client-reborn": {
      "command": "api_client_reborn",
      "args": [
        "mcp",
        "--workspace",
        "/absolute/path/to/your/api-workspace"
      ]
    }
  }
}
```

---

## 🛠️ Available MCP Tools

| Tool Name | Annotations | Description |
| :--- | :--- | :--- |
| `list_requests` | `readOnly` | Lists all `.curl`, `.grpcurl`, and `.grpc` requests with their method, name, description, and relative path. |
| `get_request` | `readOnly` | Reads and parses a `.curl`, `.grpcurl`, or `.grpc` request file, returning method, url, headers, body, sidecar tests, and raw file content. |
| `execute_request` | `openWorldHint` | Executes a saved `.curl` HTTP request with environment resolution and secret injection; runs test assertions and returns status, headers, body, duration, and test results. |
| `execute_grpc_request` | `openWorldHint` | Executes a saved `.grpcurl` or `.grpc` request with protobuf reflection or local proto file, metadata, TLS, and sidecar assertions. |
| `execute_quick_curl` | `openWorldHint` | Executes an ad-hoc raw cURL command against an environment without saving it to disk. |
| `save_request` | `destructive` | Creates or updates a `.curl`, `.grpcurl`, or `.grpc` request file and companion sidecar metadata on disk. |
| `list_environments` | `readOnly` | Lists all available environment configurations (`environments/*.env.json`) with secrets safely masked. |

---

## 🔒 Canonical Secrets & Variable Precedence

Variable precedence resolves from lowest to highest:
1. `environments/default.env.json` (or legacy `workspace.env.json` fallback).
2. Selected environment, explicitly supplied or from the request's `@env` directive (`environments/{env}.env.json`).
3. Nearest collection `collection_variables.json`.
4. `.apiclient/.secrets.env`.
5. Per-call `variables`.

Dynamic built-ins (`$uuid`, `$isoTimestamp`, `$timestamp`, `$randomInt(min, max)`) remain reserved and take precedence during interpolation.

MCP uses `.apiclient/.secrets.env` as the canonical secret store (parsing `KEY=VALUE` pairs with comment and quote support). Legacy JSON secret stores are ignored by MCP. Secret values are injected only during execution; environment listings and metadata expose masked values (`***`) only.

---

## ⚡ Bounded Execution & Cancellation

- **Server Max Response Limit**: Configured via `--max-response-bytes` (default: 4 MiB). Requests exceeding the limit immediately fail with an explicit response-size error.
- **Concurrent Request Handling & Cancellation**: The stdio server handles requests concurrently and tracks active requests. Sending a `notifications/cancelled` notification aborts active HTTP, gRPC, and QuickJS execution.

---

## 🧪 Testing the Native MCP Binary

Run the native Rust backend test suite:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```
