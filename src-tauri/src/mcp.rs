//! Native stdio MCP server.
//!
//! This module intentionally has no dependency on the application bundle layout. The same
//! executable that launches the desktop application can be launched with `mcp --workspace` and
//! serves the workspace supplied by the caller.

use crate::engine::http::execute_http_request_collect;
use crate::env::resolver::resolve_variables;
use crate::parser::comment_meta::{
    compose_file_content, extract_comments_and_command, RequestMetadata,
};
use crate::parser::curl::{parse_curl_command, HeaderPair};
use rquickjs::{Context, Function, Runtime};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const PROTOCOL_VERSION: &str = "2024-11-05";
const SERVER_NAME: &str = "api-client-reborn-mcp";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

type McpResult<T> = std::result::Result<T, String>;

#[derive(Clone)]
struct Workspace {
    root: PathBuf,
}

impl Workspace {
    fn new(path: &str) -> Self {
        let root = if path.trim().is_empty() || path == "." {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".api-client-reborn")
        } else {
            PathBuf::from(path)
        };
        Self {
            root: root.canonicalize().unwrap_or(root),
        }
    }

    fn safe_path(&self, relative: &str) -> McpResult<PathBuf> {
        let rel = relative
            .replace('\\', "/")
            .trim_start_matches('/')
            .to_string();
        if Path::new(&rel)
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err(format!(
                "Access denied: path '{}' escapes workspace root.",
                relative
            ));
        }
        let candidate = self.root.join(&rel);
        let normalized = candidate
            .canonicalize()
            .unwrap_or_else(|_| candidate.clone());
        if normalized != self.root && !normalized.starts_with(&self.root) {
            return Err(format!(
                "Access denied: path '{}' escapes workspace root.",
                relative
            ));
        }
        Ok(candidate)
    }

    fn relative(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    }

    fn list_requests(&self, folder: &str) -> McpResult<Vec<Value>> {
        let root = if folder.trim().is_empty() {
            self.root.clone()
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

    fn read_request(&self, relative: &str) -> McpResult<Value> {
        let path = self.safe_path(relative)?;
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("Request file not found: {} ({})", relative, e))?;
        let is_grpc = relative.ends_with(".grpc") || relative.ends_with(".grpcurl");
        let sidecar = self.read_sidecar(&path);
        let (meta, command) = extract_comments_and_command(&raw);
        if is_grpc {
            let method = crate::fs::workspace::parse_grpc_method_from_command(&command);
            return Ok(json!({
                "path": relative.replace('\\', "/"),
                "name": meta.name.unwrap_or_else(|| path.file_stem().unwrap_or_default().to_string_lossy().to_string()),
                "description": meta.description,
                "type": "grpc",
                "method": method,
                "endpoint": "",
                "rawContent": raw,
                "sidecar": sidecar,
            }));
        }
        let parsed = parse_curl_command(&command).map_err(|e| e.to_string())?;
        Ok(json!({
            "path": relative.replace('\\', "/"),
            "name": meta.name.unwrap_or_else(|| path.file_stem().unwrap_or_default().to_string_lossy().to_string()),
            "description": meta.description,
            "type": "http",
            "method": parsed.method.to_string(),
            "endpoint": parsed.url,
            "headers": parsed.headers.iter().map(|h| json!({"key": h.key, "value": h.value})).collect::<Vec<_>>(),
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

    fn list_environments(&self) -> Vec<Value> {
        let mut result = Vec::new();
        let dir = self.root.join("environments");
        let Ok(entries) = fs::read_dir(dir) else {
            return result;
        };
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
                    let secret = key.to_lowercase().contains("token")
                        || key.to_lowercase().contains("secret")
                        || key.to_lowercase().contains("password")
                        || key.to_lowercase().contains("key")
                        || key.to_lowercase().contains("auth")
                        || key.to_lowercase().contains("bearer");
                    (
                        key,
                        if secret {
                            Value::String("***".into())
                        } else {
                            Value::String(value.as_str().unwrap_or(&value.to_string()).into())
                        },
                    )
                })
                .collect::<Map<_, _>>();
            result.push(json!({"name": name.trim_end_matches(".env.json"), "fileName": name, "variables": variables}));
        }
        result.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        result
    }

    fn resolve_variables(
        &self,
        request_path: Option<&str>,
        environment: Option<&str>,
        overrides: &Map<String, Value>,
    ) -> HashMap<String, String> {
        let mut vars = HashMap::new();
        merge_json_object(&mut vars, &self.root.join("workspace.env.json"));
        if let Some(name) = environment {
            merge_json_object(
                &mut vars,
                &self
                    .root
                    .join("environments")
                    .join(format!("{}.env.json", name)),
            );
        }
        if let Some(request_path) = request_path {
            if let Ok(request) = self.safe_path(request_path) {
                let mut current = request.parent().unwrap_or(&self.root);
                loop {
                    let candidate = current.join(".apiclient/collection_variables.json");
                    if candidate.is_file() {
                        merge_json_object_key(&mut vars, &candidate, "public_vars");
                        merge_json_object_key(&mut vars, &candidate, "secret_vars");
                        break;
                    }
                    if current == self.root {
                        break;
                    }
                    let Some(parent) = current.parent() else {
                        break;
                    };
                    current = parent;
                }
            }
        }
        merge_json_object(&mut vars, &self.root.join(".apiclient/.secrets.json"));
        if let Ok(env) = crate::env::secret_file::load_secrets_env(&self.root) {
            vars.extend(env);
        }
        for (key, value) in overrides {
            if let Some(value) = value.as_str() {
                vars.insert(key.clone(), value.to_string());
            } else {
                vars.insert(key.clone(), value.to_string());
            }
        }
        vars
    }

    fn save_request(
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
        let path = self.safe_path(&rel)?;
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

fn merge_json_object(target: &mut HashMap<String, String>, path: &Path) {
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(values) = serde_json::from_str::<Map<String, Value>>(&raw) {
            for (key, value) in values {
                target.insert(
                    key,
                    value.as_str().unwrap_or(&value.to_string()).to_string(),
                );
            }
        }
    }
}

fn merge_json_object_key(target: &mut HashMap<String, String>, path: &Path, key: &str) {
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(values) = serde_json::from_str::<Value>(&raw) {
            if let Some(values) = values.get(key).and_then(Value::as_object) {
                for (key, value) in values {
                    target.insert(
                        key.clone(),
                        value.as_str().unwrap_or(&value.to_string()).to_string(),
                    );
                }
            }
        }
    }
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
) -> McpResult<()> {
    if script.trim().is_empty() {
        return Ok(());
    }
    let runtime = Runtime::new().map_err(|e| e.to_string())?;
    runtime.set_memory_limit(8 * 1024 * 1024);
    runtime.set_max_stack_size(256 * 1024);
    let deadline = Instant::now() + std::time::Duration::from_secs(2);
    runtime.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline)));
    let context = Context::full(&runtime).map_err(|e| e.to_string())?;
    context.with(|ctx| -> rquickjs::Result<()> {
        let globals = ctx.globals();
        let env_state = state.clone();
        let get_env = Function::new(ctx.clone(), move |key: String| -> Option<String> { env_state.lock().ok()?.environment.get(&key).cloned() })?;
        let env_state = state.clone();
        let set_env = Function::new(ctx.clone(), move |key: String, value: String| { if let Ok(mut state) = env_state.lock() { state.environment.insert(key, value); } })?;
        let env_state = state.clone();
        let unset_env = Function::new(ctx.clone(), move |key: String| { if let Ok(mut state) = env_state.lock() { state.environment.remove(&key); } })?;
        let env_state = state.clone();
        let get_header = Function::new(ctx.clone(), move |key: String| -> Option<String> { env_state.lock().ok()?.headers.iter().find(|h| h.key.eq_ignore_ascii_case(&key)).map(|h| h.value.clone()) })?;
        let env_state = state.clone();
        let add_header = Function::new(ctx.clone(), move |key: String, value: String| { if let Ok(mut state) = env_state.lock() { if let Some(header) = state.headers.iter_mut().find(|h| h.key.eq_ignore_ascii_case(&key)) { header.value = value; } else { state.headers.push(HeaderPair { key, value }); } } })?;
        let env_state = state.clone();
        let remove_header = Function::new(ctx.clone(), move |key: String| { if let Ok(mut state) = env_state.lock() { state.headers.retain(|h| !h.key.eq_ignore_ascii_case(&key)); } })?;
        let env_state = state.clone();
        let record_test = Function::new(ctx.clone(), move |name: String, passed: bool, error: Option<String>| { if let Ok(mut state) = env_state.lock() { state.tests.push(json!({"name": name, "passed": passed, "error": error})); } })?;
        let env_state = state.clone();
        let log = Function::new(ctx.clone(), move |message: String| { if let Ok(mut state) = env_state.lock() { state.logs.push(message); } })?;
        globals.set("__get_env", get_env)?;
        globals.set("__set_env", set_env)?;
        globals.set("__unset_env", unset_env)?;
        globals.set("__get_header", get_header)?;
        globals.set("__add_header", add_header)?;
        globals.set("__remove_header", remove_header)?;
        globals.set("__record_test", record_test)?;
        globals.set("__log", log)?;
        let response_json = serde_json::to_string(&response.unwrap_or(Value::Null)).unwrap_or_else(|_| "null".into());
        let bootstrap = format!(r#"
            const __response = JSON.parse({response_json});
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
        "#);
        ctx.eval::<(), _>(bootstrap.as_str())?;
        ctx.eval::<(), _>(script)?;
        Ok(())
    }).map_err(|e| e.to_string())
}

async fn execute_http(
    raw_content: &str,
    variables: HashMap<String, String>,
    sidecar: Option<&Value>,
) -> McpResult<Value> {
    let (_meta, command) = extract_comments_and_command(raw_content);
    let resolved = resolve_variables(&command, &variables);
    let initial = parse_curl_command(&resolved).map_err(|e| e.to_string())?;
    let state = Arc::new(Mutex::new(ScriptState {
        environment: variables,
        headers: initial.headers.clone(),
        ..Default::default()
    }));
    if let Some(script) = sidecar
        .and_then(|v| v.get("pre_request_script"))
        .and_then(Value::as_str)
    {
        if let Err(error) = run_script(script, state.clone(), None) {
            if let Ok(mut state) = state.lock() {
                state.logs.push(format!("[Pre-request error] {}", error));
            }
        }
    }
    let variables = state
        .lock()
        .map_err(|_| "script state lock poisoned".to_string())?
        .environment
        .clone();
    let mut parsed =
        parse_curl_command(&resolve_variables(&command, &variables)).map_err(|e| e.to_string())?;
    if let Ok(state) = state.lock() {
        parsed.headers = state.headers.clone();
    }
    let response = execute_http_request_collect(parsed)
        .await
        .map_err(|error| error.to_string())?;
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
    let response_value = json!({"status": status, "statusText": status_text, "durationMs": response.duration_ms, "headers": headers, "body": body, "isJson": parsed_json.is_some(), "parsedJson": parsed_json});
    if let Some(script) = sidecar
        .and_then(|v| v.get("post_response_script"))
        .and_then(Value::as_str)
    {
        if let Err(error) = run_script(script, state.clone(), Some(response_value.clone())) {
            if let Ok(mut state) = state.lock() {
                state.logs.push(format!("[Post-response error] {}", error));
            }
        }
    }
    let state = state
        .lock()
        .map_err(|_| "script state lock poisoned".to_string())?;
    let mut result = response_value.as_object().cloned().unwrap_or_default();
    result.insert("tests".into(), Value::Array(state.tests.clone()));
    result.insert(
        "logs".into(),
        Value::Array(state.logs.iter().cloned().map(Value::String).collect()),
    );
    Ok(Value::Object(result))
}

struct McpServer {
    workspace: Workspace,
}

impl McpServer {
    fn new(workspace: &str) -> Self {
        Self {
            workspace: Workspace::new(workspace),
        }
    }

    async fn handle(&self, request: Value) -> Option<Value> {
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let method = request.get("method").and_then(Value::as_str).unwrap_or("");
        let notification = !request.get("id").is_some();
        let result = match method {
            "initialize" => Ok(
                json!({"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {}, "resources": {}}, "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION}}),
            ),
            "notifications/initialized" => return None,
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
                self.call_tool(request.get("params").and_then(Value::as_object))
                    .await
            }
            _ => Err(format!("Method not found: {}", method)),
        };
        if notification {
            return None;
        }
        Some(match result {
            Ok(result) => json!({"jsonrpc":"2.0", "id": id, "result": result}),
            Err(message) => {
                json!({"jsonrpc":"2.0", "id": id, "error":{"code":-32603,"message":message}})
            }
        })
    }

    fn read_resource(&self, uri: Option<&str>) -> McpResult<Value> {
        let value = match uri {
            Some("workspace://tree") => json!(self.workspace.list_requests("")?),
            Some("workspace://environments") => json!(self.workspace.list_environments()),
            _ => return Err(format!("Resource not found: {}", uri.unwrap_or(""))),
        };
        Ok(
            json!({"contents":[{"uri":uri.unwrap_or(""),"mimeType":"application/json","text":serde_json::to_string_pretty(&value).unwrap_or_default()}]}),
        )
    }

    async fn call_tool(&self, params: Option<&Map<String, Value>>) -> McpResult<Value> {
        match self.call_tool_inner(params).await {
            Ok(value) => Ok(value),
            Err(message) => Ok(text_result(&format!("Tool error: {}", message), true)),
        }
    }

    async fn call_tool_inner(&self, params: Option<&Map<String, Value>>) -> McpResult<Value> {
        let params = params.ok_or_else(|| "Missing tool parameters".to_string())?;
        let name = params.get("name").and_then(Value::as_str).unwrap_or("");
        let args = params
            .get("arguments")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let value = match name {
            "list_requests" => {
                let requests = self
                    .workspace
                    .list_requests(args.get("folder").and_then(Value::as_str).unwrap_or(""))?;
                json!({"total": requests.len(), "requests": requests})
            }
            "get_request" => json!(self.workspace.read_request(
                args.get("path")
                    .and_then(Value::as_str)
                    .ok_or("Missing required argument 'path'")?
            )?),
            "save_request" => {
                json!({"success":true,"savedPath":self.workspace.save_request(args.get("path").and_then(Value::as_str).ok_or("Missing required argument 'path'")?, args.get("content").and_then(Value::as_str).ok_or("Missing required argument 'content'")?, &args)?})
            }
            "list_environments" => {
                let envs = self.workspace.list_environments();
                json!({"total":envs.len(),"environments":envs})
            }
            "execute_quick_curl" => {
                let vars = self.workspace.resolve_variables(
                    None,
                    args.get("environment").and_then(Value::as_str),
                    args.get("variables")
                        .and_then(Value::as_object)
                        .unwrap_or(&Map::new()),
                );
                execute_http(
                    args.get("curl_command")
                        .and_then(Value::as_str)
                        .ok_or("Missing required argument 'curl_command'")?,
                    vars,
                    None,
                )
                .await?
            }
            "execute_request" => {
                let path = args
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or("Missing required argument 'path'")?;
                let request = self.workspace.read_request(path)?;
                if request["type"] == "grpc" {
                    return Ok(text_result("Direct gRPC execution via MCP is planned for v1.1. Inspect request via get_request or run via desktop application.", true));
                }
                let vars = self.workspace.resolve_variables(
                    Some(path),
                    args.get("environment").and_then(Value::as_str),
                    args.get("variables")
                        .and_then(Value::as_object)
                        .unwrap_or(&Map::new()),
                );
                execute_http(
                    request["rawContent"].as_str().unwrap_or(""),
                    vars,
                    request.get("sidecar"),
                )
                .await?
            }
            _ => return Ok(text_result(&format!("Unknown tool: {}", name), true)),
        };
        Ok(text_result(
            &serde_json::to_string_pretty(&value).unwrap_or_default(),
            false,
        ))
    }
}

fn text_result(text: &str, is_error: bool) -> Value {
    json!({"content":[{"type":"text","text":text}],"isError":is_error})
}

fn tools() -> Value {
    json!([
        {"name":"list_requests","description":"Lists all .curl, .grpcurl, and .grpc requests in the workspace with method, name, description, and relative path.","inputSchema":{"type":"object","properties":{"folder":{"type":"string"}}}},
        {"name":"get_request","description":"Reads and inspects a request file, including headers, directives, and companion sidecar scripts.","inputSchema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}},
        {"name":"execute_request","description":"Executes a saved .curl request with environment resolution and secret injection.","inputSchema":{"type":"object","properties":{"path":{"type":"string"},"environment":{"type":"string"},"variables":{"type":"object"}},"required":["path"]}},
        {"name":"execute_quick_curl","description":"Executes an ad-hoc raw cURL command against an environment without saving it to disk.","inputSchema":{"type":"object","properties":{"curl_command":{"type":"string"},"environment":{"type":"string"},"variables":{"type":"object"}},"required":["curl_command"]}},
        {"name":"save_request","description":"Creates or updates a .curl, .grpcurl, or .grpc request file and companion sidecar metadata in the workspace repository.","inputSchema":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"},"name":{"type":"string"},"description":{"type":"string"},"sidecar":{"type":"object"}},"required":["path","content"]}},
        {"name":"list_environments","description":"Lists all available workspace environments and non-secret variables.","inputSchema":{"type":"object","properties":{}}}
    ])
}

fn resources() -> Value {
    json!([
        {"uri":"workspace://tree","name":"Workspace Requests Tree","description":"Structured index of all HTTP and gRPC requests in the workspace","mimeType":"application/json"},
        {"uri":"workspace://environments","name":"Workspace Environments","description":"Active environment configurations and non-secret variables","mimeType":"application/json"}
    ])
}

pub fn run_stdio(workspace: &str) {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("MCP runtime");
    runtime.block_on(async move {
        let server = McpServer::new(workspace);
        let stdin = tokio::io::stdin();
        let mut lines = BufReader::new(stdin).lines();
        let mut stdout = tokio::io::BufWriter::new(tokio::io::stdout());
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() { continue; }
            let response = match serde_json::from_str::<Value>(&line) {
                Ok(request) => server.handle(request).await,
                Err(_) => Some(json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error: invalid JSON"}})),
            };
            if let Some(response) = response {
                if let Ok(serialized) = serde_json::to_string(&response) {
                    let _ = stdout.write_all(serialized.as_bytes()).await;
                    let _ = stdout.write_all(b"\n").await;
                    let _ = stdout.flush().await;
                }
            }
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
        let server = McpServer::new(workspace.to_string_lossy().as_ref());
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
        assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 6);
        assert!(tools["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "execute_request"));
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

    #[test]
    fn quickjs_pm_compatibility_updates_environment_and_records_tests() {
        let state = Arc::new(Mutex::new(ScriptState {
            environment: HashMap::from([(String::from("before"), String::from("yes"))]),
            ..Default::default()
        }));
        run_script(
            "pm.environment.set('trace_id', 'abc'); pm.test('works', function () { pm.expect(pm.environment.get('before')).to.equal('yes'); }); console.log('hello');",
            state.clone(),
            None,
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

    #[test]
    fn quickjs_script_interrupts_infinite_loops() {
        let state = Arc::new(Mutex::new(ScriptState::default()));
        let error = run_script("while (true) {}", state, None).unwrap_err();
        assert!(!error.is_empty());
    }
}
