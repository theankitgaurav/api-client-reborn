//! Native stdio MCP server.
//!
//! This module intentionally has no dependency on the application bundle layout. The same
//! executable that launches the desktop application can be launched with `mcp --workspace <path>`
//! and serves the workspace supplied by the caller over standard JSON-RPC 2.0 stdio.

use crate::engine::grpc::execute_grpc_request_collect;
use crate::engine::http::{execute_http_request_collect, CollectedHttpResponse};
use crate::env::resolver::{resolve_variables, resolve_workspace_variables};
use crate::env::secret_file::load_secrets_env;
use crate::error::AppError;
use crate::fs::workspace_path::WorkspacePathValidator;
use crate::parser::comment_meta::{
    compose_file_content, extract_comments_and_command, RequestMetadata,
};
use crate::parser::curl::{parse_curl_command, HeaderPair};
use crate::parser::grpcurl::parse_grpc_request;
use rquickjs::{Context, Function, Runtime};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio_util::sync::CancellationToken;

pub const PROTOCOL_VERSION: &str = "2024-11-05";
pub const SERVER_NAME: &str = "api-client-reborn-mcp";
pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const DEFAULT_MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024; // 4 MiB

type McpResult<T> = std::result::Result<T, String>;

#[derive(Clone)]
pub struct Workspace {
    validator: WorkspacePathValidator,
}

impl Workspace {
    pub fn new(path: &str) -> Self {
        let root = if path.trim().is_empty() || path == "." {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".api-client-reborn")
        } else {
            PathBuf::from(path)
        };
        let validator = WorkspacePathValidator::new(&root).unwrap_or_else(|_| {
            WorkspacePathValidator::new(&PathBuf::from(".")).unwrap()
        });
        Self { validator }
    }

    pub fn root(&self) -> &Path {
        self.validator.root()
    }

    pub fn safe_path(&self, relative: &str) -> McpResult<PathBuf> {
        self.validator.validate_existing_path(relative)
    }

    pub fn safe_write_path(&self, relative: &str) -> McpResult<PathBuf> {
        self.validator.validate_write_path(relative)
    }

    pub fn relative(&self, path: &Path) -> String {
        self.validator.relative_str(path)
    }

    pub fn list_requests(&self, folder: &str) -> McpResult<Vec<Value>> {
        let root = if folder.trim().is_empty() {
            self.validator.root().to_path_buf()
        } else {
            self.safe_path(folder)?
        };
        let mut requests = Vec::new();
        self.scan_requests(&root, &mut requests)?;
        requests.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
        Ok(requests)
    }

    fn scan_requests(&self, dir: &Path, output: &mut Vec<Value>) -> McpResult<()> {
        if !dir.is_dir() {
            return Ok(());
        }
        let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if name.starts_with('.')
                    || matches!(
                        name.as_str(),
                        "node_modules"
                            | "target"
                            | "dist"
                            | "build"
                            | "src"
                            | "src-tauri"
                            | "docs"
                            | "tests"
                    )
                {
                    continue;
                }
                self.scan_requests(&path, output)?;
                continue;
            }
            if !path.is_file()
                || !(name.ends_with(".curl")
                    || name.ends_with(".grpcurl")
                    || name.ends_with(".grpc"))
            {
                continue;
            }
            if let Ok(details) = self.read_request(&self.relative(&path)) {
                output.push(json!({
                    "path": details["path"],
                    "name": details["name"],
                    "description": details["description"],
                    "type": details["type"],
                    "method": details["method"],
                    "endpoint": details["endpoint"],
                }));
            }
        }
        Ok(())
    }

    pub fn read_request(&self, relative: &str) -> McpResult<Value> {
        WorkspacePathValidator::validate_request_extension(relative)?;
        let path = self.safe_path(relative)?;
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("Request file not found: {} ({})", relative, e))?;
        let is_grpc = relative.ends_with(".grpc") || relative.ends_with(".grpcurl");
        let sidecar = self.read_sidecar(&path);
        let (meta, command) = extract_comments_and_command(&raw);

        // Load secret keys from .secrets.env to redact from metadata
        let secret_keys = self.load_secret_keys();

        if is_grpc {
            let config = parse_grpc_request(&raw).map_err(|e| e.to_string())?;
            let display_name = meta.name.unwrap_or(config.name);
            let display_method = format!("{}/{}", config.service, config.method);
            let redacted_metadata = config
                .metadata
                .iter()
                .map(|h| {
                    json!({
                        "key": h.key,
                        "value": if is_secret_name(&h.key, &secret_keys) { "***" } else { &h.value }
                    })
                })
                .collect::<Vec<_>>();

            return Ok(json!({
                "path": relative.replace('\\', "/"),
                "name": display_name,
                "description": meta.description,
                "type": "grpc",
                "method": display_method,
                "endpoint": config.endpoint,
                "metadata": redacted_metadata,
                "protoFile": config.proto_file,
                "useReflection": config.use_reflection,
                "tlsEnabled": config.tls_enabled,
                "rawContent": raw,
                "sidecar": sidecar,
            }));
        }

        let parsed = parse_curl_command(&command).map_err(|e| e.to_string())?;
        let redacted_headers = parsed
            .headers
            .iter()
            .map(|h| {
                json!({
                    "key": h.key,
                    "value": if is_secret_name(&h.key, &secret_keys) { "***" } else { &h.value }
                })
            })
            .collect::<Vec<_>>();

        Ok(json!({
            "path": relative.replace('\\', "/"),
            "name": meta.name.unwrap_or_else(|| path.file_stem().unwrap_or_default().to_string_lossy().to_string()),
            "description": meta.description,
            "type": "http",
            "method": parsed.method.to_string(),
            "endpoint": parsed.url,
            "headers": redacted_headers,
            "body": parsed.body,
            "rawContent": raw,
            "sidecar": sidecar,
        }))
    }

    fn read_sidecar(&self, request_path: &Path) -> Option<Value> {
        for extension in ["meta.json", "sidecar.json"] {
            let candidate = request_path.with_extension(extension);
            if let Ok(raw) = fs::read_to_string(candidate) {
                if let Ok(value) = serde_json::from_str(&raw) {
                    return Some(value);
                }
            }
        }
        None
    }

    fn load_secret_keys(&self) -> HashSet<String> {
        let mut keys = HashSet::new();
        if let Ok(secrets) = load_secrets_env(self.root()) {
            for k in secrets.keys() {
                keys.insert(k.to_lowercase());
            }
        }
        keys
    }

    pub fn list_environments(&self) -> Vec<Value> {
        let mut result = Vec::new();
        let dir = self.root().join("environments");
        let Ok(entries) = fs::read_dir(dir) else {
            return result;
        };
        let secret_keys = self.load_secret_keys();

        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".env.json") {
                continue;
            }
            let Ok(raw) = fs::read_to_string(path) else {
                continue;
            };
            let Ok(values) = serde_json::from_str::<Map<String, Value>>(&raw) else {
                continue;
            };
            let variables = values
                .into_iter()
                .map(|(key, value)| {
                    let masked = is_secret_name(&key, &secret_keys);
                    (
                        key,
                        if masked {
                            Value::String("***".into())
                        } else {
                            Value::String(value.as_str().unwrap_or(&value.to_string()).into())
                        },
                    )
                })
                .collect::<Map<_, _>>();
            result.push(json!({
                "name": name.trim_end_matches(".env.json"),
                "fileName": name,
                "variables": variables
            }));
        }
        result.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        result
    }

    pub fn resolve_variables_for_request(
        &self,
        request_path: Option<&str>,
        explicit_environment: Option<&str>,
        directive_environment: Option<&str>,
        overrides: &HashMap<String, String>,
    ) -> HashMap<String, String> {
        let req_path_buf = request_path.map(PathBuf::from);
        resolve_workspace_variables(
            self.root(),
            req_path_buf.as_deref(),
            explicit_environment,
            directive_environment,
            overrides,
        )
    }

    pub fn save_request(
        &self,
        relative: &str,
        content: &str,
        args: &Map<String, Value>,
    ) -> McpResult<String> {
        let mut rel = relative
            .replace('\\', "/")
            .trim_start_matches('/')
            .to_string();
        if !(rel.ends_with(".curl") || rel.ends_with(".grpcurl") || rel.ends_with(".grpc")) {
            rel.push_str(".curl");
        }
        let path = self.safe_write_path(&rel)?;
        let name = args.get("name").and_then(Value::as_str);
        let description = args.get("description").and_then(Value::as_str);
        let final_content = if name.is_some() || description.is_some() {
            let mut meta = RequestMetadata::default();
            meta.name = name.map(str::to_string);
            meta.description = description.map(str::to_string);
            let (_, command) = extract_comments_and_command(content);
            compose_file_content(&meta, &command)
        } else {
            content.to_string()
        };
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&path, final_content).map_err(|e| e.to_string())?;
        if let Some(sidecar) = args.get("sidecar") {
            let sidecar_path = path.with_extension("meta.json");
            fs::write(
                sidecar_path,
                serde_json::to_string_pretty(sidecar).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(rel)
    }
}

fn is_secret_name(key: &str, secret_keys: &HashSet<String>) -> bool {
    let lower = key.to_lowercase();
    secret_keys.contains(&lower)
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("password")
        || lower.contains("key")
        || lower.contains("auth")
        || lower.contains("bearer")
        || lower.contains("cookie")
        || lower.contains("credential")
}

#[derive(Default)]
struct ScriptState {
    environment: HashMap<String, String>,
    headers: Vec<HeaderPair>,
    tests: Vec<Value>,
    logs: Vec<String>,
}

fn run_script(
    script: &str,
    state: Arc<Mutex<ScriptState>>,
    response: Option<Value>,
    cancel_token: CancellationToken,
) -> McpResult<()> {
    if script.trim().is_empty() {
        return Ok(());
    }
    if cancel_token.is_cancelled() {
        return Err("Request cancelled".into());
    }

    let runtime = Runtime::new().map_err(|e| e.to_string())?;
    runtime.set_memory_limit(8 * 1024 * 1024);
    runtime.set_max_stack_size(256 * 1024);
    let deadline = Instant::now() + std::time::Duration::from_secs(2);
    let cancel = cancel_token.clone();
    runtime.set_interrupt_handler(Some(Box::new(move || {
        cancel.is_cancelled() || Instant::now() >= deadline
    })));

    let context = Context::full(&runtime).map_err(|e| e.to_string())?;
    context
        .with(|ctx| -> rquickjs::Result<()> {
            let globals = ctx.globals();
            let env_state = state.clone();
            let get_env = Function::new(ctx.clone(), move |key: String| -> Option<String> {
                env_state.lock().ok()?.environment.get(&key).cloned()
            })?;
            let env_state = state.clone();
            let set_env = Function::new(ctx.clone(), move |key: String, value: String| {
                if let Ok(mut state) = env_state.lock() {
                    state.environment.insert(key, value);
                }
            })?;
            let env_state = state.clone();
            let unset_env = Function::new(ctx.clone(), move |key: String| {
                if let Ok(mut state) = env_state.lock() {
                    state.environment.remove(&key);
                }
            })?;
            let env_state = state.clone();
            let get_header = Function::new(ctx.clone(), move |key: String| -> Option<String> {
                env_state
                    .lock()
                    .ok()?
                    .headers
                    .iter()
                    .find(|h| h.key.eq_ignore_ascii_case(&key))
                    .map(|h| h.value.clone())
            })?;
            let env_state = state.clone();
            let add_header = Function::new(ctx.clone(), move |key: String, value: String| {
                if let Ok(mut state) = env_state.lock() {
                    if let Some(header) = state
                        .headers
                        .iter_mut()
                        .find(|h| h.key.eq_ignore_ascii_case(&key))
                    {
                        header.value = value;
                    } else {
                        state.headers.push(HeaderPair { key, value });
                    }
                }
            })?;
            let env_state = state.clone();
            let remove_header = Function::new(ctx.clone(), move |key: String| {
                if let Ok(mut state) = env_state.lock() {
                    state.headers.retain(|h| !h.key.eq_ignore_ascii_case(&key));
                }
            })?;
            let env_state = state.clone();
            let record_test = Function::new(
                ctx.clone(),
                move |name: String, passed: bool, error: Option<String>| {
                    if let Ok(mut state) = env_state.lock() {
                        state
                            .tests
                            .push(json!({"name": name, "passed": passed, "error": error}));
                    }
                },
            )?;
            let env_state = state.clone();
            let log = Function::new(ctx.clone(), move |message: String| {
                if let Ok(mut state) = env_state.lock() {
                    state.logs.push(message);
                }
            })?;

            globals.set("__get_env", get_env)?;
            globals.set("__set_env", set_env)?;
            globals.set("__unset_env", unset_env)?;
            globals.set("__get_header", get_header)?;
            globals.set("__add_header", add_header)?;
            globals.set("__remove_header", remove_header)?;
            globals.set("__record_test", record_test)?;
            globals.set("__log", log)?;

            let response_json = serde_json::to_string(&response.unwrap_or(Value::Null))
                .unwrap_or_else(|_| "null".into());
            let bootstrap = format!(
                r#"
            const __response = {response_json};
            const __assert = (ok, message) => {{ if (!ok) throw new Error(message); }};
            const __expect = (actual, negated = false) => {{
              const e = {{}};
              Object.defineProperty(e, 'to', {{ get: () => e }});
              Object.defineProperty(e, 'be', {{ get: () => e }});
              Object.defineProperty(e, 'have', {{ get: () => e }});
              Object.defineProperty(e, 'not', {{ get: () => __expect(actual, !negated) }});
              const check = (ok, message) => __assert(negated ? !ok : ok, message);
              e.equal = (expected) => check(actual === expected, `expected ${{JSON.stringify(actual)}} to equal ${{JSON.stringify(expected)}}`);
              e.eql = e.equal; e.equals = e.equal;
              e.exist = (() => check(actual !== null && actual !== undefined, 'expected value to exist'))();
              e.include = (item) => check((typeof actual === 'string' || Array.isArray(actual)) && actual.includes(item), 'expected value to include item');
              e.contain = e.include; e.contains = e.include;
              e.above = (n) => check(Number(actual) > n, `expected ${{actual}} to be above ${{n}}`);
              e.greaterThan = e.above;
              e.below = (n) => check(Number(actual) < n, `expected ${{actual}} to be below ${{n}}`);
              e.lessThan = e.below;
              e.least = (n) => check(Number(actual) >= n, `expected ${{actual}} to be at least ${{n}}`);
              e.most = (n) => check(Number(actual) <= n, `expected ${{actual}} to be at most ${{n}}`);
              return e;
            }};
            const pm = {{
              environment: {{ get: __get_env, set: (k,v) => __set_env(k, String(v)), has: (k) => __get_env(k) !== undefined, unset: __unset_env, toObject: () => ({{}}) }},
              variables: {{ get: __get_env, set: (k,v) => __set_env(k, String(v)), has: (k) => __get_env(k) !== undefined }},
              request: {{ headers: {{ add: (h) => __add_header(h.key, h.value), get: __get_header, remove: __remove_header }} }},
              test: (name, fn) => {{ try {{ fn(); __record_test(name, true, null); }} catch (e) {{ __record_test(name, false, String(e.message || e)); }} }},
              expect: __expect
            }};
            if (__response !== null) pm.response = {{ code: __response.status, status: __response.statusText, responseTime: __response.durationMs, text: () => __response.body, json: () => JSON.parse(__response.body), headers: {{ get: (k) => __response.headers[k.toLowerCase()] }}, to: {{ have: {{ status: (expected) => __assert(typeof expected === 'number' ? __response.status === expected : __response.statusText.toLowerCase() === String(expected).toLowerCase(), 'unexpected response status') }} }} }};
            const console = {{ log: (...args) => __log(args.map(String).join(' ')), info: (...args) => __log(args.map(String).join(' ')), warn: (...args) => __log('[WARN] ' + args.map(String).join(' ')), error: (...args) => __log('[ERROR] ' + args.map(String).join(' ')) }};
        "#
            );
            ctx.eval::<(), _>(bootstrap.as_str())?;
            ctx.eval::<(), _>(script)?;
            Ok(())
        })
        .map_err(|e| {
            if cancel_token.is_cancelled() {
                "Request cancelled".to_string()
            } else {
                e.to_string()
            }
        })
}

async fn execute_http_bounded(
    raw_content: &str,
    variables: HashMap<String, String>,
    sidecar: Option<&Value>,
    cancel_token: CancellationToken,
    max_response_bytes: usize,
    workspace: &Workspace,
) -> Result<Value, AppError> {
    let (meta, command) = extract_comments_and_command(raw_content);
    let resolved = resolve_variables(&command, &variables);
    let initial = parse_curl_command(&resolved).map_err(|e| AppError::CurlParserError(e.to_string()))?;

    // Validate any upload files against the workspace validator
    for field in &initial.form_fields {
        if let Some(ref path_str) = field.file_path {
            let _ = workspace
                .validator
                .validate_existing_path(path_str)
                .map_err(|e| AppError::FsError(e))?;
        }
    }

    let state = Arc::new(Mutex::new(ScriptState {
        environment: variables,
        headers: initial.headers.clone(),
        ..Default::default()
    }));

    if let Some(script) = sidecar
        .and_then(|v| v.get("pre_request_script"))
        .and_then(Value::as_str)
    {
        if let Err(error) = run_script(script, state.clone(), None, cancel_token.clone()) {
            if cancel_token.is_cancelled() {
                return Err(AppError::Cancelled);
            }
            if let Ok(mut state) = state.lock() {
                state.logs.push(format!("[Pre-request error] {}", error));
            }
        }
    }

    if cancel_token.is_cancelled() {
        return Err(AppError::Cancelled);
    }

    let updated_vars = state
        .lock()
        .map_err(|_| AppError::InternalError("script state lock poisoned".to_string()))?
        .environment
        .clone();

    let mut parsed = parse_curl_command(&resolve_variables(&command, &updated_vars))
        .map_err(|e| AppError::CurlParserError(e.to_string()))?;

    if let Ok(state) = state.lock() {
        parsed.headers = state.headers.clone();
    }

    // Apply timeout from directive or fallback to default 30s
    if parsed.timeout_ms.is_none() {
        parsed.timeout_ms = meta.timeout_ms.or(Some(30_000));
    }

    let response = execute_http_request_collect(parsed, cancel_token.clone(), max_response_bytes).await?;
    build_sidecar_response(response, sidecar, state, cancel_token)
}

async fn execute_grpc_bounded(
    raw_content: &str,
    variables: HashMap<String, String>,
    sidecar: Option<&Value>,
    cancel_token: CancellationToken,
    max_response_bytes: usize,
    workspace: &Workspace,
) -> Result<Value, AppError> {
    let mut config = parse_grpc_request(raw_content).map_err(|e| AppError::GrpcParserError(e.to_string()))?;

    // Validate proto_file and tls_ca_file against workspace validator
    if let Some(ref proto) = config.proto_file {
        let _ = workspace
            .validator
            .validate_existing_path(proto)
            .map_err(AppError::FsError)?;
    }
    if let Some(ref ca) = config.tls_ca_file {
        let _ = workspace
            .validator
            .validate_existing_path(ca)
            .map_err(AppError::FsError)?;
    }

    let state = Arc::new(Mutex::new(ScriptState {
        environment: variables.clone(),
        headers: config.metadata.clone(),
        ..Default::default()
    }));

    if let Some(script) = sidecar
        .and_then(|v| v.get("pre_request_script"))
        .and_then(Value::as_str)
    {
        if let Err(error) = run_script(script, state.clone(), None, cancel_token.clone()) {
            if cancel_token.is_cancelled() {
                return Err(AppError::Cancelled);
            }
            if let Ok(mut state) = state.lock() {
                state.logs.push(format!("[Pre-request error] {}", error));
            }
        }
    }

    if cancel_token.is_cancelled() {
        return Err(AppError::Cancelled);
    }

    let updated_vars = state
        .lock()
        .map_err(|_| AppError::InternalError("script state lock poisoned".to_string()))?
        .environment
        .clone();

    if let Ok(state) = state.lock() {
        config.metadata = state.headers.clone();
    }

    // Resolve variables in endpoint, request_json, and metadata
    config.endpoint = resolve_variables(&config.endpoint, &updated_vars);
    config.request_json = resolve_variables(&config.request_json, &updated_vars);
    for meta_item in &mut config.metadata {
        meta_item.value = resolve_variables(&meta_item.value, &updated_vars);
    }

    if config.timeout_ms == 0 {
        config.timeout_ms = 30_000;
    }

    let response = execute_grpc_request_collect(
        config,
        cancel_token.clone(),
        max_response_bytes,
        Some(workspace.root()),
    )
    .await?;

    build_sidecar_response(response, sidecar, state, cancel_token)
}

fn build_sidecar_response(
    response: CollectedHttpResponse,
    sidecar: Option<&Value>,
    state: Arc<Mutex<ScriptState>>,
    cancel_token: CancellationToken,
) -> Result<Value, AppError> {
    let status = response.status;
    let status_text = response.status_text.clone();
    let mut headers = Map::new();
    for header in &response.headers {
        headers.insert(
            header.key.to_lowercase(),
            Value::String(header.value.clone()),
        );
    }
    let body = response.body.clone();
    let parsed_json = serde_json::from_str::<Value>(&body).ok();
    let response_value = json!({
        "status": status,
        "statusText": status_text,
        "durationMs": response.duration_ms,
        "headers": headers,
        "body": body,
        "isJson": parsed_json.is_some(),
        "parsedJson": parsed_json
    });

    if let Some(script) = sidecar
        .and_then(|v| v.get("post_response_script"))
        .and_then(Value::as_str)
    {
        if let Err(error) = run_script(script, state.clone(), Some(response_value.clone()), cancel_token.clone()) {
            if cancel_token.is_cancelled() {
                return Err(AppError::Cancelled);
            }
            if let Ok(mut state) = state.lock() {
                state.logs.push(format!("[Post-response error] {}", error));
            }
        }
    }

    let state = state
        .lock()
        .map_err(|_| AppError::InternalError("script state lock poisoned".to_string()))?;

    let mut result = response_value.as_object().cloned().unwrap_or_default();
    result.insert("tests".into(), Value::Array(state.tests.clone()));
    result.insert(
        "logs".into(),
        Value::Array(state.logs.iter().cloned().map(Value::String).collect()),
    );
    Ok(Value::Object(result))
}

pub struct McpServer {
    pub workspace: Workspace,
    pub max_response_bytes: usize,
    active_requests: Arc<Mutex<HashMap<Value, CancellationToken>>>,
}

impl McpServer {
    pub fn new(workspace: &str, max_response_bytes: usize) -> Self {
        Self {
            workspace: Workspace::new(workspace),
            max_response_bytes,
            active_requests: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn cancel_request(&self, request_id: &Value) -> bool {
        if let Ok(map) = self.active_requests.lock() {
            if let Some(token) = map.get(request_id) {
                token.cancel();
                return true;
            }
        }
        false
    }

    pub async fn handle(&self, request: Value) -> Option<Value> {
        let id = request.get("id").cloned();
        let method = request.get("method").and_then(Value::as_str).unwrap_or("");

        // Cancellation notification handling
        if method == "notifications/cancelled" {
            if let Some(params) = request.get("params").and_then(Value::as_object) {
                let req_id = params
                    .get("requestId")
                    .or_else(|| params.get("id"))
                    .cloned();
                if let Some(ref rid) = req_id {
                    self.cancel_request(rid);
                }
            }
            return None;
        }

        let is_notification = id.is_none();
        let id_val = id.unwrap_or(Value::Null);

        // Register cancellation token for this request
        let cancel_token = CancellationToken::new();
        if !is_notification {
            if let Ok(mut map) = self.active_requests.lock() {
                map.insert(id_val.clone(), cancel_token.clone());
            }
        }

        let result = match method {
            "initialize" => Ok(json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {
                    "tools": {},
                    "resources": {}
                },
                "serverInfo": {
                    "name": SERVER_NAME,
                    "version": SERVER_VERSION
                }
            })),
            "notifications/initialized" => {
                if let Ok(mut map) = self.active_requests.lock() {
                    map.remove(&id_val);
                }
                return None;
            }
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({"tools": tools()})),
            "resources/list" => Ok(json!({"resources": resources()})),
            "resources/read" => self.read_resource(
                request
                    .get("params")
                    .and_then(|v| v.get("uri"))
                    .and_then(Value::as_str),
            ),
            "tools/call" => {
                self.call_tool(
                    request.get("params").and_then(Value::as_object),
                    cancel_token.clone(),
                )
                .await
            }
            _ => Err((-32601, format!("Method not found: {}", method))),
        };

        // Clean up cancellation token
        if let Ok(mut map) = self.active_requests.lock() {
            map.remove(&id_val);
        }

        if is_notification {
            return None;
        }

        Some(match result {
            Ok(result) => json!({"jsonrpc":"2.0", "id": id_val, "result": result}),
            Err((code, message)) => {
                json!({"jsonrpc":"2.0", "id": id_val, "error":{"code": code, "message": message}})
            }
        })
    }

    fn read_resource(&self, uri: Option<&str>) -> Result<Value, (i64, String)> {
        let value = match uri {
            Some("workspace://tree") => json!(self.workspace.list_requests("").map_err(|e| (-32603, e))?),
            Some("workspace://environments") => json!(self.workspace.list_environments()),
            _ => return Err((-32602, format!("Resource not found: {}", uri.unwrap_or("")))),
        };
        Ok(
            json!({"contents":[{"uri":uri.unwrap_or(""),"mimeType":"application/json","text":serde_json::to_string_pretty(&value).unwrap_or_default()}]}),
        )
    }

    async fn call_tool(
        &self,
        params: Option<&Map<String, Value>>,
        cancel_token: CancellationToken,
    ) -> Result<Value, (i64, String)> {
        match self.call_tool_inner(params, cancel_token).await {
            Ok(value) => Ok(value),
            Err(AppError::Cancelled) => Err((-32800, "Request cancelled".to_string())),
            Err(error) => Ok(text_result(&format!("Tool error: {}", error), true)),
        }
    }

    async fn call_tool_inner(
        &self,
        params: Option<&Map<String, Value>>,
        cancel_token: CancellationToken,
    ) -> Result<Value, AppError> {
        let params = params.ok_or_else(|| AppError::InternalError("Missing tool parameters".into()))?;
        let name = params.get("name").and_then(Value::as_str).unwrap_or("");
        let args = params
            .get("arguments")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        let value = match name {
            "list_requests" => {
                let folder = args.get("folder").and_then(Value::as_str).unwrap_or("");
                let requests = self
                    .workspace
                    .list_requests(folder)
                    .map_err(AppError::FsError)?;
                json!({"total": requests.len(), "requests": requests})
            }
            "get_request" => {
                let path = args
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::InternalError("Missing required argument 'path'".into()))?;
                json!(self.workspace.read_request(path).map_err(AppError::FsError)?)
            }
            "save_request" => {
                let path = args
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::InternalError("Missing required argument 'path'".into()))?;
                let content = args
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::InternalError("Missing required argument 'content'".into()))?;
                let saved_path = self
                    .workspace
                    .save_request(path, content, &args)
                    .map_err(AppError::FsError)?;
                json!({"success": true, "savedPath": saved_path})
            }
            "list_environments" => {
                let envs = self.workspace.list_environments();
                json!({"total": envs.len(), "environments": envs})
            }
            "execute_quick_curl" => {
                let cmd = args
                    .get("curl_command")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::InternalError("Missing required argument 'curl_command'".into()))?;
                let per_call_vars = extract_string_map(args.get("variables"));
                let vars = self.workspace.resolve_variables_for_request(
                    None,
                    args.get("environment").and_then(Value::as_str),
                    None,
                    &per_call_vars,
                );
                execute_http_bounded(
                    cmd,
                    vars,
                    None,
                    cancel_token,
                    self.max_response_bytes,
                    &self.workspace,
                )
                .await?
            }
            "execute_request" => {
                let path = args
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::InternalError("Missing required argument 'path'".into()))?;

                if path.ends_with(".grpc") || path.ends_with(".grpcurl") {
                    return Err(AppError::InternalError(
                        "execute_request only supports .curl HTTP requests. Use execute_grpc_request to execute .grpcurl or .grpc requests.".into(),
                    ));
                }

                let request = self.workspace.read_request(path).map_err(AppError::FsError)?;
                let raw_content = request["rawContent"].as_str().unwrap_or("");
                let (meta, _) = extract_comments_and_command(raw_content);

                let per_call_vars = extract_string_map(args.get("variables"));
                let vars = self.workspace.resolve_variables_for_request(
                    Some(path),
                    args.get("environment").and_then(Value::as_str),
                    meta.default_env.as_deref(),
                    &per_call_vars,
                );

                execute_http_bounded(
                    raw_content,
                    vars,
                    request.get("sidecar"),
                    cancel_token,
                    self.max_response_bytes,
                    &self.workspace,
                )
                .await?
            }
            "execute_grpc_request" => {
                let path = args
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::InternalError("Missing required argument 'path'".into()))?;

                if path.ends_with(".curl") {
                    return Err(AppError::InternalError(
                        "execute_grpc_request only supports .grpcurl and .grpc requests. Use execute_request for HTTP requests.".into(),
                    ));
                }

                let request = self.workspace.read_request(path).map_err(AppError::FsError)?;
                let raw_content = request["rawContent"].as_str().unwrap_or("");
                let (meta, _) = extract_comments_and_command(raw_content);

                let per_call_vars = extract_string_map(args.get("variables"));
                let vars = self.workspace.resolve_variables_for_request(
                    Some(path),
                    args.get("environment").and_then(Value::as_str),
                    meta.default_env.as_deref(),
                    &per_call_vars,
                );

                execute_grpc_bounded(
                    raw_content,
                    vars,
                    request.get("sidecar"),
                    cancel_token,
                    self.max_response_bytes,
                    &self.workspace,
                )
                .await?
            }
            _ => return Err(AppError::InternalError(format!("Unknown tool: {}", name))),
        };

        Ok(text_result(
            &serde_json::to_string_pretty(&value).unwrap_or_default(),
            false,
        ))
    }
}

fn extract_string_map(val: Option<&Value>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(obj) = val.and_then(Value::as_object) {
        for (k, v) in obj {
            let s = v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string());
            map.insert(k.clone(), s);
        }
    }
    map
}

fn text_result(text: &str, is_error: bool) -> Value {
    json!({"content":[{"type":"text","text":text}],"isError":is_error})
}

pub fn tools() -> Value {
    json!([
        {
            "name": "list_requests",
            "description": "Lists all .curl, .grpcurl, and .grpc requests in the workspace with method, name, description, and relative path.",
            "annotations": {
                "readOnly": true,
                "readOnlyHint": true
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "folder": {
                        "type": "string",
                        "description": "Optional workspace-relative folder path to filter requests (e.g. 'auth' or 'users')"
                    }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "get_request",
            "description": "Reads and inspects a request file (.curl, .grpcurl, or .grpc), returning method, URL, headers, directives, and companion sidecar metadata.",
            "annotations": {
                "readOnly": true,
                "readOnlyHint": true
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path to a request file (.curl, .grpcurl, or .grpc)"
                    }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "execute_request",
            "description": "Executes a saved .curl HTTP request with environment resolution and secret injection; runs test assertions and returns status, headers, body, duration, and test results.",
            "annotations": {
                "openWorldHint": true
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path to a .curl HTTP request file"
                    },
                    "environment": {
                        "type": "string",
                        "description": "Optional environment name to activate (e.g. 'development', 'staging', 'production')"
                    },
                    "variables": {
                        "type": "object",
                        "description": "Key-value map of variable overrides for this execution",
                        "additionalProperties": {
                            "type": "string"
                        }
                    }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "execute_grpc_request",
            "description": "Executes a saved .grpcurl or .grpc request with protobuf reflection or local proto file, metadata, TLS, and sidecar assertions.",
            "annotations": {
                "openWorldHint": true
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path to a .grpcurl or .grpc request file"
                    },
                    "environment": {
                        "type": "string",
                        "description": "Optional environment name to activate (e.g. 'development', 'staging', 'production')"
                    },
                    "variables": {
                        "type": "object",
                        "description": "Key-value map of variable overrides for this execution",
                        "additionalProperties": {
                            "type": "string"
                        }
                    }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "execute_quick_curl",
            "description": "Executes an ad-hoc raw cURL command against an environment without saving it to disk.",
            "annotations": {
                "openWorldHint": true
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "curl_command": {
                        "type": "string",
                        "description": "Raw cURL command line to parse and execute"
                    },
                    "environment": {
                        "type": "string",
                        "description": "Optional environment name to activate"
                    },
                    "variables": {
                        "type": "object",
                        "description": "Key-value map of variable overrides for this execution",
                        "additionalProperties": {
                            "type": "string"
                        }
                    }
                },
                "required": ["curl_command"],
                "additionalProperties": false
            }
        },
        {
            "name": "save_request",
            "description": "Creates or updates a .curl, .grpcurl, or .grpc request file and companion sidecar metadata in the workspace repository.",
            "annotations": {
                "destructive": true,
                "destructiveHint": true
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path for the request file (.curl, .grpcurl, or .grpc)"
                    },
                    "content": {
                        "type": "string",
                        "description": "Raw request command or JSON content"
                    },
                    "name": {
                        "type": "string",
                        "description": "Human-readable display name for the request"
                    },
                    "description": {
                        "type": "string",
                        "description": "Optional request description or documentation"
                    },
                    "sidecar": {
                        "type": "object",
                        "description": "Companion metadata sidecar with pre/post scripts and assertions",
                        "properties": {
                            "pre_request_script": {
                                "type": "string",
                                "description": "JavaScript pre-request script executed before dispatch"
                            },
                            "post_response_script": {
                                "type": "string",
                                "description": "JavaScript post-response script executed after response arrives"
                            },
                            "tests": {
                                "type": "array",
                                "description": "List of test assertions",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "id": { "type": "string" },
                                        "name": { "type": "string" },
                                        "script": { "type": "string" }
                                    },
                                    "required": ["name"],
                                    "additionalProperties": false
                                }
                            }
                        },
                        "additionalProperties": false
                    }
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }
        },
        {
            "name": "list_environments",
            "description": "Lists all available workspace environments and non-secret variables.",
            "annotations": {
                "readOnly": true,
                "readOnlyHint": true
            },
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        }
    ])
}

pub fn resources() -> Value {
    json!([
        {
            "uri": "workspace://tree",
            "name": "Workspace Requests Tree",
            "description": "Structured index of all HTTP and gRPC requests in the workspace",
            "mimeType": "application/json"
        },
        {
            "uri": "workspace://environments",
            "name": "Workspace Environments",
            "description": "Active environment configurations and non-secret variables",
            "mimeType": "application/json"
        }
    ])
}

pub fn run_stdio(workspace: &str, max_response_bytes: usize) {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("MCP runtime");

    runtime.block_on(async move {
        let server = Arc::new(McpServer::new(workspace, max_response_bytes));
        let stdin = tokio::io::stdin();
        let mut lines = BufReader::new(stdin).lines();
        let stdout = Arc::new(tokio::sync::Mutex::new(BufWriter::new(tokio::io::stdout())));

        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            let request: Value = match serde_json::from_str(&line) {
                Ok(req) => req,
                Err(_) => {
                    let err_resp = json!({
                        "jsonrpc": "2.0",
                        "id": null,
                        "error": {
                            "code": -32700,
                            "message": "Parse error: invalid JSON"
                        }
                    });
                    let mut out = stdout.lock().await;
                    if let Ok(ser) = serde_json::to_string(&err_resp) {
                        let _ = out.write_all(ser.as_bytes()).await;
                        let _ = out.write_all(b"\n").await;
                        let _ = out.flush().await;
                    }
                    continue;
                }
            };

            // Process cancellation notifications immediately without blocking
            if request.get("method").and_then(Value::as_str) == Some("notifications/cancelled") {
                let s = server.clone();
                s.handle(request).await;
                continue;
            }

            // Spawn concurrent handler for requests
            let server_clone = server.clone();
            let stdout_clone = stdout.clone();
            tokio::spawn(async move {
                let response = server_clone.handle(request).await;
                if let Some(response) = response {
                    if let Ok(serialized) = serde_json::to_string(&response) {
                        let mut out = stdout_clone.lock().await;
                        let _ = out.write_all(serialized.as_bytes()).await;
                        let _ = out.write_all(b"\n").await;
                        let _ = out.flush().await;
                    }
                }
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace() -> PathBuf {
        let path = std::env::temp_dir().join(format!("api-client-mcp-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[tokio::test]
    async fn native_server_preserves_initialize_and_tool_contract() {
        let workspace = temp_workspace();
        let server = McpServer::new(workspace.to_string_lossy().as_ref(), DEFAULT_MAX_RESPONSE_BYTES);
        let response = server
            .handle(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}))
            .await
            .unwrap();
        assert_eq!(response["result"]["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(response["result"]["serverInfo"]["name"], SERVER_NAME);

        let tools = server
            .handle(json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
            .await
            .unwrap();
        let tool_list = tools["result"]["tools"].as_array().unwrap();
        assert_eq!(tool_list.len(), 7);
        assert!(tool_list.iter().any(|tool| tool["name"] == "execute_request"));
        assert!(tool_list.iter().any(|tool| tool["name"] == "execute_grpc_request"));

        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn workspace_rejects_parent_traversal() {
        let workspace = temp_workspace();
        let manager = Workspace::new(workspace.to_string_lossy().as_ref());
        let error = manager.safe_path("../../etc/passwd").unwrap_err();
        assert!(error.contains("escapes workspace root"));
        let _ = fs::remove_dir_all(workspace);
    }

    #[tokio::test]
    async fn quickjs_pm_compatibility_updates_environment_and_records_tests() {
        let state = Arc::new(Mutex::new(ScriptState {
            environment: HashMap::from([(String::from("before"), String::from("yes"))]),
            ..Default::default()
        }));
        run_script(
            "pm.environment.set('trace_id', 'abc'); pm.test('works', function () { pm.expect(pm.environment.get('before')).to.equal('yes'); }); console.log('hello');",
            state.clone(),
            None,
            CancellationToken::new(),
        )
        .unwrap();
        let state = state.lock().unwrap();
        assert_eq!(
            state.environment.get("trace_id"),
            Some(&String::from("abc"))
        );
        assert_eq!(state.tests[0]["name"], "works");
        assert_eq!(
            state.tests[0]["passed"], true,
            "script test result: {:?}",
            state.tests
        );
        assert_eq!(state.logs, vec!["hello"]);
    }

    #[tokio::test]
    async fn quickjs_script_interrupts_infinite_loops() {
        let state = Arc::new(Mutex::new(ScriptState::default()));
        let error = run_script("while (true) {}", state, None, CancellationToken::new()).unwrap_err();
        assert!(!error.is_empty());
    }

    #[tokio::test]
    async fn quickjs_script_cancels_via_token() {
        let state = Arc::new(Mutex::new(ScriptState::default()));
        let token = CancellationToken::new();
        token.cancel();
        let error = run_script("pm.environment.set('a', 'b');", state, None, token).unwrap_err();
        assert!(error.contains("cancelled"));
    }
}
