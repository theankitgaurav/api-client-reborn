<p align="center">
  <img src="app-icon.svg" width="128" height="128" alt="API Client Reborn Logo" />
</p>

<h1 align="center">API Client Reborn</h1>

<p align="center">
  <strong>Send HTTP and gRPC requests, keep them in files, and share them with Git.</strong>
</p>

<p align="center">
  <a href="https://github.com/theankitgaurav/api-client-reborn/releases/latest"><img src="https://img.shields.io/github/v/release/theankitgaurav/api-client-reborn?style=flat-square" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License MIT" /></a>
</p>

<p align="center">
  <a href="#-installation">Download</a> •
  <a href="#-your-first-request">First request</a> •
  <a href="#-features">Features</a> •
  <a href="#-architecture--file-formats">File Formats</a> •
  <a href="#-quickstart-development">Development</a> •
  <a href="#-keyboard-shortcuts">Shortcuts</a> •
  <a href="#-license">License</a>
</p>

---

API Client Reborn is an open-source desktop client built with Tauri, Rust, and Svelte. Work with local request files, inspect HTTP and gRPC streams, import Postman collections, and connect AI assistants through MCP.

## 📥 Installation

Download the latest release for macOS, Windows, or Linux from [**GitHub Releases**](https://github.com/theankitgaurav/api-client-reborn/releases/latest).

| Platform | Package |
| :--- | :--- |
| **macOS** | Universal `.dmg` |
| **Windows** | x64 `.exe` (NSIS) or `.msi` |
| **Linux** | x86_64 `.deb` or `.AppImage` |

### macOS
1. Open the downloaded `.dmg` and drag **API Client Reborn** to `/Applications`.
2. For unsigned builds, if Gatekeeper prompts about an unidentified developer, right-click the app in `/Applications` and choose **Open**, or run:
   ```bash
   xattr -cr "/Applications/API Client Reborn.app"
   ```

### Windows
Run the `.exe` or `.msi` installer. The app requires Microsoft Edge WebView2 Evergreen Runtime, pre-installed on Windows 11 and updated Windows 10.

### Linux
Install the `.deb` on Ubuntu / Debian:
```bash
sudo apt update
sudo apt install ./api-client-reborn_*_amd64.deb
```
Or make the AppImage executable and run it:
```bash
chmod +x api-client-reborn_*_amd64.AppImage
./api-client-reborn_*_amd64.AppImage
```

For system prerequisites, distribution instructions, and code signing information, see [**docs/DISTRIBUTION.md**](docs/DISTRIBUTION.md).

## 🚀 Your First Request

1. Open the app and create an HTTP request with **New Request** or <kbd>⌘</kbd>+<kbd>N</kbd> (Windows/Linux: <kbd>Ctrl</kbd>+<kbd>N</kbd>).
2. Enter a URL such as `https://httpbin.org/get` and select **Send**, or press <kbd>⌘</kbd>+<kbd>Enter</kbd> (Windows/Linux: <kbd>Ctrl</kbd>+<kbd>Enter</kbd>).
3. To keep the request, press <kbd>⌘</kbd>+<kbd>S</kbd> (Windows/Linux: <kbd>Ctrl</kbd>+<kbd>S</kbd>), choose a name and workspace folder, and save it as a `.curl` file.

Use the command palette with <kbd>⌘</kbd>+<kbd>K</kbd> (Windows/Linux: <kbd>Ctrl</kbd>+<kbd>K</kbd>), or see the [keyboard shortcuts](#-keyboard-shortcuts).

---

## ✨ Features

### 🔌 HTTP Request Engine
- **Full HTTP/REST Support**: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, and `OPTIONS`.
- **Multipart File Uploads**: Attach files to form-data requests and send them with other multipart fields.
- **Response File Downloads**: Save file responses directly to disk from the response panel.

### 🔌 gRPC Request Engine
- **Unary and Streaming RPCs**: Send unary, client-streaming, server-streaming, and bidirectional calls with JSON messages and request metadata.
- **Proto Discovery**: Load services and methods from server reflection or a local `.proto` file. Local proto discovery works without connecting to the server.
- **TLS Controls**: Use system trust roots or a custom CA, with an explicit option to bypass server certificate validation.
- **Saved Requests and CLI Copy**: Save requests as `.grpcurl` files in collection folders and copy them as `grpcurl` commands.
- **Disk-Spooled Responses**: Streaming response bodies are written to disk, with a bounded response preview in the UI and history and an option to export the full stream.

### 🌊 Real-Time Streaming & Server-Sent Events (SSE)
- **Live Event Streamer**: Inspect chunked HTTP streaming endpoints and Server-Sent Events with structured event IDs, types, and payloads.
- **Bounded Preview**: A sliding window limits the events retained in the interface.
- **Background Disk Spooling**: Streaming response data is written to disk (`engine/spooler.rs`).

### 🪄 Dynamic Variables & Hover Tooltips
- **Built-in Generators**: Automatically generate dynamic values such as `{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, and `{{$randomInt}}`.
- **Interactive Variable Cards**: Hover over a `{{variable}}` to view its evaluated value, active scope, and secret status.

### 🔐 Multi-Environment & Safe Secret Management
- **Environment Switcher**: Organize variables into JSON environments (`development.env.json`, `production.env.json`).
- **Environment Import**: Import Postman environment exports and switch the active environment from the Variables menu.
- **Variable Scopes**: Use workspace, environment, and collection variables. See the [MCP guide](docs/MCP_GUIDE.md) for MCP variable resolution.
- **Secret Isolation**: Mark sensitive variables as secrets to store them separately. The app adds ignore rules for secret files; check Git status before committing.

### 🧪 Postman Scripting & Chai Assertions
- **Pre-Request & Post-Response Scripts**: Write JavaScript using supported Postman-style APIs such as `pm.environment.get()`, `pm.environment.set()`, and `pm.response.json()`.
- **Chai-style Assertions**: Validate responses with `pm.test()`, `pm.expect()`, latency thresholds, and header checks. Status badges display passed and failed tests.

### 📦 Postman Collection v2.1 Importer
- Import Postman collections (v2.1 JSON), including folders, headers, supported auth, request bodies, collection variables, and pre/post scripts, into `.curl` and `.sidecar.json` files. Import Postman environment exports separately and select them in the app.

### 🚀 Collection CLI Exporter (`.sh`)
- Export collections or folders into a portable shell script. Running HTTP exports requires cURL; gRPC exports additionally require `grpcurl`. No Node.js, Python, or proprietary CLI runner is needed.

### 🤖 Model Context Protocol (MCP) Server for AI Coding Agents
- Built-in, zero-dependency MCP server over stdio for AI coding assistants (**Claude Desktop**, **Cursor**, **Antigravity**, **VS Code Copilot**, **Zed**).
- Exposes tools to discover (`list_requests`), inspect (`get_request`), execute HTTP (`execute_request`, `execute_quick_curl`) and gRPC (`execute_grpc_request`), and save requests (`save_request`).
- See [**docs/MCP_GUIDE.md**](docs/MCP_GUIDE.md) for quick client setup configurations.

### ⌨️ Keyboard Shortcuts
- Create requests (`Cmd+N`), switch tabs (`Cmd+1..9`, `Ctrl+Tab`), send/cancel (`Cmd+Enter`), focus the URL bar (`Cmd+L`), and open the command palette (`Cmd+K`) or shortcut cheat sheet (`?` or `Cmd+/`).

### 🌓 Adaptive Dark / Light UI
- Designed with Tailwind CSS and Svelte 5 runes. Includes a streamlined titlebar, draggable workspace splitter, tab color customization, and responsive layout.

---

## 📁 Architecture & File Formats

The default workspace is `~/.api-client-reborn`; you can also work in your own folder. A workspace can look like this:

```text
my-api-project/
├── environments/development.env.json
├── collections/
│   ├── auth/login.curl
│   ├── auth/.apiclient/login.sidecar.json
│   └── users/ListUsers.grpcurl
├── .apiclient/.secrets.env
└── history.json
```

| File | Purpose |
| :--- | :--- |
| `.curl` / `.grpcurl` | Readable request commands, with optional `# @directive` metadata. The app also supports `.grpc` request files. |
| `.apiclient/*.sidecar.json` | Optional request metadata, tests, and scripts beside a collection. |
| `environments/*.env.json` | Environment variables, selectable from the Variables menu. |
| `.apiclient/.secrets.env` | Workspace secrets. Environment and collection secrets are stored separately in `*.secrets.json` files. |
| `history.json` | Local request history, including response previews and paths to spooled streaming responses. |

The app adds secret-file rules to the workspace `.gitignore` when saving secrets. Git ignore rules do not protect files already tracked, so check Git status before committing. Request files may contain variable placeholders that must be resolved before running them outside the app.

See the [example requests](examples/) and the [MCP guide](docs/MCP_GUIDE.md) for workspace and variable resolution details.

---

## 🛠️ Quickstart (Development)

### Prerequisites
- **Node.js**: v22.0.0 or higher
- **Rust**: Stable toolchain (`rustc`, `cargo`)
- **System Webview**: Native OS webview (WebKit on macOS, WebView2 on Windows, WebKit2GTK on Linux)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/theankitgaurav/api-client-reborn.git
cd api-client-reborn
npm install
```

### 2. Run in Development Mode

#### Frontend Only (Vite Web Server)
```bash
npm run dev
```
Open `http://localhost:1420` in your browser. (Note: filesystem and native networking features require the Tauri runtime).

#### Full Desktop Application (Tauri + Vite)
```bash
npm run tauri dev
```

### 3. Run Automated Tests & Quality Checks
```bash
# TypeScript & Svelte compiler checks
npm run check

# Frontend unit & integration tests (Node.js test runner)
npm run test:frontend

# Backend Rust unit tests (Cargo)
npm run test:backend

# Full verification suite (check + tests + build)
npm test
```

### 4. Build Production Packages
```bash
# Compile frontend assets
npm run build

# Package desktop installer for your current operating system
npm run tauri build
```

The resulting distribution packages will be generated in `src-tauri/target/release/bundle/`.

### Manual Capability Checks

The **Examples** collection is seeded into `~/.api-client-reborn/examples` and includes requests for manual feature checks. HTTP examples use `https://httpbin.org`; gRPC examples use ConnectRPC (`grpc_host`/`grpc_port`) and Google's interoperability service (`grpc_interop_host`/`grpc_interop_port`); the SSE example uses HTTPCan (`sse_base_url`). These checks require an internet connection.

| Example folder | What to try |
| :--- | :--- |
| `methods/` | PUT, PATCH, DELETE, HEAD, and OPTIONS requests |
| `auth/` | Basic authentication and Bearer authentication with the local `auth_token` secret |
| `responses/` | HTTP 404 handling, redirects with and without `-L`, and a timeout that intentionally fails |
| `scripting/` | Pre-request variable setup and post-response assertions; view results in the Tests tab |
| `streaming/` | Five SSE events arrive, then the response completes automatically |

The existing root examples cover query parameters, headers, dynamic variables, JSON bodies, and chunked streaming. The timeout example is expected to fail after one second; raise its `# @timeout` value to `5000` to see the delayed response succeed.

---

## ⌨️ Keyboard Shortcuts

Press <kbd>?</kbd> or <kbd>⌘</kbd> + <kbd>/</kbd> anywhere in the application to display the interactive shortcuts cheatsheet.

### Tabs
| Action | macOS | Windows / Linux |
| :--- | :--- | :--- |
| **New Request** | <kbd>⌘</kbd> + <kbd>N</kbd> | <kbd>Ctrl</kbd> + <kbd>N</kbd> |
| **Close Active Tab** | <kbd>⌘</kbd> + <kbd>W</kbd> | <kbd>Ctrl</kbd> + <kbd>W</kbd> |
| **Close Other Tabs** | <kbd>⌘</kbd> + <kbd>⌥</kbd> + <kbd>W</kbd> | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>W</kbd> |
| **Next Tab** | <kbd>Ctrl</kbd> + <kbd>Tab</kbd> / <kbd>⌘</kbd> + <kbd>⌥</kbd> + <kbd>→</kbd> | <kbd>Ctrl</kbd> + <kbd>Tab</kbd> |
| **Previous Tab** | <kbd>Ctrl</kbd> + <kbd>⇧</kbd> + <kbd>Tab</kbd> / <kbd>⌘</kbd> + <kbd>⌥</kbd> + <kbd>←</kbd> | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Tab</kbd> |
| **Switch to Tab 1–8** | <kbd>⌘</kbd> + <kbd>1</kbd> .. <kbd>8</kbd> | <kbd>Ctrl</kbd> + <kbd>1</kbd> .. <kbd>8</kbd> |
| **Switch to Last Tab** | <kbd>⌘</kbd> + <kbd>9</kbd> | <kbd>Ctrl</kbd> + <kbd>9</kbd> |

### Request Execution & Saving
| Action | macOS | Windows / Linux |
| :--- | :--- | :--- |
| **Send / Cancel Request** | <kbd>⌘</kbd> + <kbd>↵</kbd> | <kbd>Ctrl</kbd> + <kbd>Enter</kbd> |
| **Save Request** | <kbd>⌘</kbd> + <kbd>S</kbd> | <kbd>Ctrl</kbd> + <kbd>S</kbd> |
| **Beautify JSON** | <kbd>⌘</kbd> + <kbd>⌥</kbd> + <kbd>B</kbd> | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>B</kbd> |

### Navigation & Dialogs
| Action | macOS | Windows / Linux |
| :--- | :--- | :--- |
| **Focus URL Input** | <kbd>⌘</kbd> + <kbd>L</kbd> | <kbd>Ctrl</kbd> + <kbd>L</kbd> |
| **Filter Requests** | <kbd>⌘</kbd> + <kbd>F</kbd> / <kbd>⌘</kbd> + <kbd>P</kbd> | <kbd>Ctrl</kbd> + <kbd>F</kbd> / <kbd>Ctrl</kbd> + <kbd>P</kbd> |
| **Variables & Secrets** | <kbd>⌘</kbd> + <kbd>E</kbd> | <kbd>Ctrl</kbd> + <kbd>E</kbd> |
| **Command Palette** | <kbd>⌘</kbd> + <kbd>K</kbd> | <kbd>Ctrl</kbd> + <kbd>K</kbd> |
| **Toggle Workspace Sidebar** | <kbd>⌘</kbd> + <kbd>\\</kbd> | <kbd>Ctrl</kbd> + <kbd>\\</kbd> |
| **Close Modal / Dismiss** | <kbd>Esc</kbd> | <kbd>Esc</kbd> |
| **Keyboard Cheatsheet** | <kbd>⌘</kbd> + <kbd>/</kbd> or <kbd>?</kbd> | <kbd>Ctrl</kbd> + <kbd>/</kbd> or <kbd>?</kbd> |

---

## 🤖 Automated CI/CD Release Pipeline

A GitHub Actions automated release pipeline is configured in [`.github/workflows/release.yml`](.github/workflows/release.yml).

### Publishing a New Release
1. Update version numbers in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
2. Commit and tag the release:
   ```bash
   git commit -am "chore: release v0.5.0"
   git tag v0.5.0
   git push origin main --tags
   ```
3. GitHub Actions will automatically:
   - Build macOS Universal binary (`.dmg`).
   - Build Windows installer (`.exe`, `.msi`).
   - Build Linux packages (`.deb`, `.AppImage`).
   - Run verification checks and test suites.
   - Publish a Draft Release on GitHub with all binaries attached.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'feat: add some amazing feature'`).
4. Ensure all tests pass (`npm test`).
5. Push to the branch (`git push origin feature/amazing-feature`).
6. Open a Pull Request.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

<p align="center">
  Built with ❤️ for developers who love speed, simplicity, and open protocols.
</p>
