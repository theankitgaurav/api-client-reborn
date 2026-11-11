# Model Context Protocol (MCP) Guide for API Client Reborn

The **API Client Reborn MCP Server** exposes your local, Git-versioned API collections and environments to modern AI coding assistants (Claude Desktop, Cursor, Antigravity, VS Code Copilot, Zed).

AI agents can automatically:
1. **Discover & inspect** `.curl`, `.grpcurl`, and `.grpc` requests in your repository.
2. **Execute requests** against local or remote environments (`development`, `staging`, `production`).
3. **Run test assertions** headlessly (`pm.test()`, `pm.expect()`) and inspect status codes, headers, and responses.
4. **Safely resolve secrets** from `.apiclient/.secrets.json` (secrets are injected into outgoing requests, but masked in prompts).
5. **Create & update requests** directly as `.curl` files when writing new API routes in your code.

---

## 🚀 Quick Setup

The MCP server runs over standard input/output (`stdio`) using Node.js 18+. No extra installation or dependencies are required.

### 1. Claude Desktop

Add the server to your Claude Desktop configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "api-client-reborn": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/absolute/path/to/api-client-reborn/bin/mcp.js",
        "--workspace",
        "/absolute/path/to/your/api-workspace"
      ]
    }
  }
}
```

---

### 2. Cursor

Add the server to `.cursor/mcp.json` in your repository root:

```json
{
  "mcpServers": {
    "api-client-reborn": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "${workspaceFolder}/bin/mcp.js",
        "--workspace",
        "${workspaceFolder}"
      ]
    }
  }
}
```

---

### 3. Antigravity / Gemini CLI

Configure in your workspace `.gemini/settings.json` or Antigravity MCP settings:

```json
{
  "mcpServers": {
    "api-client-reborn": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/absolute/path/to/api-client-reborn/bin/mcp.js",
        "--workspace",
        "/absolute/path/to/your/api-workspace"
      ]
    }
  }
}
```

---

## 🛠️ Available MCP Tools

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `list_requests` | `folder?: string` | Lists all `.curl`, `.grpcurl`, and `.grpc` requests with their method, name, description, and relative path. |
| `get_request` | `path: string` | Reads and parses a request file, returning method, url, headers, body, sidecar tests, and raw file content. |
| `execute_request` | `path: string`, `environment?: string`, `variables?: Record<string, string>` | Executes a saved `.curl` request with environment resolution and secret injection; runs test assertions and returns status, headers, body, duration, and test results. |
| `execute_quick_curl` | `curl_command: string`, `environment?: string`, `variables?: Record<string, string>` | Executes an ad-hoc raw cURL command against an environment without saving it to disk. |
| `save_request` | `path: string`, `content: string`, `name?: string`, `description?: string`, `sidecar?: object` | Creates or updates a `.curl`, `.grpcurl`, or `.grpc` request file and companion sidecar metadata on disk. |
| `list_environments` | none | Lists all available environment configurations (`environments/*.env.json`) with secrets safely masked. |

---

## 🔒 Secret Isolation & Security

API Client Reborn adheres to a strict zero-leakage security model:
1. **Secrets in `.secrets.json`**: Sensitive API keys and tokens are stored in `.apiclient/.secrets.json` (guaranteed to be Git-ignored).
2. **Prompt Protection**: The `list_environments` tool masks all secrets with `***`.
3. **Execution-Time Injection**: Secrets are resolved only inside `execute_request` when dispatching network calls, ensuring credentials never leak into prompt context windows.
4. **Path Traversal Defense**: All file paths are strictly bounded inside the designated workspace root; traversal attempts escaping the workspace are blocked.

---

## 💡 Example Agent Prompts

Once configured, you can prompt your AI assistant directly:

### 1. Discovering & Running APIs
> *"What authentication requests exist in our API collection? Run the login request using the development environment and tell me if the tests pass."*

The agent will:
1. Call `list_requests({ folder: "auth" })`.
2. Call `execute_request({ path: "auth/login.curl", environment: "development" })`.
3. Inspect the returned status code (`200 OK`) and Postman assertion results (`Status is 200: passed`).

### 2. Implementing & Saving New Endpoints
> *"I just added a new `POST /v1/webhooks` endpoint in `src/routes/webhooks.ts`. Create a new request in `collections/webhooks/create_webhook.curl` with sample headers and an assertion that verifies a 201 response."*

The agent will:
1. Call `save_request` with the `.curl` content and sidecar assertion script.
2. The new request will immediately appear in your Git status and in the API Client Reborn desktop app.

---

## 🧪 Testing the MCP Server

You can test the MCP server manually or via the automated test suite:

```bash
# Run MCP test suite
npm run test:mcp

# Launch interactive CLI
node --experimental-strip-types bin/mcp.js --workspace .
```
