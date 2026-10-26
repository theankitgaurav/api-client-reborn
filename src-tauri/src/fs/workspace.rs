use crate::error::{AppError, Result};
use crate::ipc::types::WorkspaceFileItem;
use crate::parser::comment_meta::extract_comments_and_command;
use crate::parser::curl::parse_curl_command;
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_APP_DIR_NAME: &str = ".api-client-reborn";

pub const IGNORED_NAMES: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "src",
    "src-tauri",
    "docs",
    "gen",
    "icons",
    ".git",
    ".apiclient",
    ".gemini",
    ".vscode",
    ".idea",
    ".svelte-kit",
    "environments",
    "tests",
    "Library",
    "Volumes",
];

const DEFAULT_DEV_ENV: &str = r#"{
  "api_host": "httpbin.org",
  "port": "443",
  "base_url": "https://httpbin.org",
  "tenant_id": "dev-tenant-101",
  "grpc_host": "localhost:50051"
}"#;

const DEFAULT_PROD_ENV: &str = r#"{
  "api_host": "api.example.com",
  "port": "443",
  "base_url": "https://api.example.com",
  "tenant_id": "prod-enterprise",
  "grpc_host": "grpc.example.com:443"
}"#;

const SAMPLE_GET_USERS: &str = r#"# @name Get All Users
# @description List registered users with pagination and trace id
# @timeout 30000

curl -X GET "{{base_url}}/get?page=1&limit=20" \
  -H "Accept: application/json" \
  -H "X-Trace-Id: {{$uuid}}" \
  -H "Authorization: Bearer {{auth_token}}"
"#;

const SAMPLE_CREATE_USER: &str = r#"# @name Create User Profile
# @timeout 15000
curl -X POST "{{base_url}}/post" \
  -H "Content-Type: application/json" \
  -H "X-Client-Id: {{tenant_id}}" \
  -H "Authorization: Bearer {{auth_token}}" \
  -d '{
  "username": "alex_developer",
  "email": "alex@example.com",
  "role": "admin",
  "registered_at": "{{$isoTimestamp}}"
}'
"#;

const SAMPLE_STREAM_EVENTS: &str = r#"# @name Stream Live Events
# @description Consumes a chunked streaming response or SSE endpoint
# @timeout 60000

curl -N "{{base_url}}/stream/10" \
  -H "Accept: application/json, text/event-stream"
"#;

const SAMPLE_GET_USER_GRPC: &str = r#"# @name Get User gRPC
# @description Sample gRPC unary call using grpcurl with reflection and metadata
# @timeout 15000

grpcurl -plaintext \
  -H "Authorization: Bearer {{auth_token}}" \
  -H "X-Client-Id: {{tenant_id}}" \
  -d '{
    "id": 42
  }' \
  {{grpc_host}} api.v1.UserService/GetUser
"#;

const SAMPLE_GET_USER_PROTO: &str = r#"# @name Get User with Proto File
# @description Sample gRPC unary call pointing to a .proto file for endpoints without server reflection
# @timeout 15000

grpcurl -plaintext \
  -proto "examples/user.proto" \
  -import-path "." \
  -H "Authorization: Bearer dev_token" \
  -d '{
    "id": 99
  }' \
  localhost:50052 api.v1.UserService/GetUser
"#;

const SAMPLE_USER_PROTO: &str = r#"syntax = "proto3";

package api.v1;

service UserService {
  rpc GetUser (UserRequest) returns (UserResponse);
  rpc Echo (EchoRequest) returns (EchoResponse);
}

message UserRequest {
  int32 id = 1;
}

message UserResponse {
  int32 id = 1;
  string name = 2;
  string email = 3;
  string role = 4;
}

message EchoRequest {
  string message = 1;
}

message EchoResponse {
  string message = 1;
  int64 timestamp = 2;
}
"#;

/// Returns the default workspace directory in the user's home folder (`~/.api-client-reborn`).
pub fn get_default_workspace_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("API_CLIENT_WORKSPACE_DIR") {
        if !custom.trim().is_empty() {
            return PathBuf::from(custom.trim());
        }
    }

    if let Some(home) = dirs::home_dir() {
        home.join(DEFAULT_APP_DIR_NAME)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    }
}

/// Ensures the workspace root directory exists and contains default environments and sample requests.
pub fn ensure_workspace_initialized(dir: &Path) -> Result<()> {
    if !dir.exists() {
        fs::create_dir_all(dir)
            .map_err(|e| AppError::FsError(format!("Failed to create workspace directory: {}", e)))?;
    }

    // 1. Environments folder & default environment configs
    let env_dir = dir.join("environments");
    if !env_dir.exists() {
        fs::create_dir_all(&env_dir)
            .map_err(|e| AppError::FsError(format!("Failed to create environments directory: {}", e)))?;
    }

    let dev_env_file = env_dir.join("development.env.json");
    if !dev_env_file.exists() {
        let _ = fs::write(&dev_env_file, DEFAULT_DEV_ENV);
    }

    let prod_env_file = env_dir.join("production.env.json");
    if !prod_env_file.exists() {
        let _ = fs::write(&prod_env_file, DEFAULT_PROD_ENV);
    }

    let default_env_file = env_dir.join("default.env.json");
    if !default_env_file.exists() {
        let _ = fs::write(&default_env_file, DEFAULT_DEV_ENV);
    }

    // 2. Secret file directory
    let apiclient_dir = dir.join(".apiclient");
    if !apiclient_dir.exists() {
        let _ = fs::create_dir_all(&apiclient_dir);
    }
    let secrets_file = apiclient_dir.join(".secrets.env");
    if !secrets_file.exists() {
        let content = "# Local-only secrets - NEVER commit this file to version control\nauth_token=demo-secret-token-42\n";
        let _ = fs::write(&secrets_file, content);
    }

    // 3. Seed starter requests and proto schemas in examples/
    let examples_dir = dir.join("examples");
    let _ = fs::create_dir_all(&examples_dir);

    let starter_files: [(&str, &str); 6] = [
        ("get_users.curl", SAMPLE_GET_USERS),
        ("create_user.curl", SAMPLE_CREATE_USER),
        ("stream_events.curl", SAMPLE_STREAM_EVENTS),
        ("get_user_grpc.grpcurl", SAMPLE_GET_USER_GRPC),
        ("get_user_proto.grpcurl", SAMPLE_GET_USER_PROTO),
        ("user.proto", SAMPLE_USER_PROTO),
    ];

    for (name, content) in starter_files {
        let path = examples_dir.join(name);
        if !path.exists() {
            let _ = fs::write(&path, content);
        }
    }

    Ok(())
}

/// Resolves workspace root. If "." or empty, returns the user's home app directory
/// (`~/.api-client-reborn`) and ensures it is initialized.
pub fn resolve_workspace_root(input: &str) -> PathBuf {
    let p = if input == "." || input.is_empty() {
        get_default_workspace_dir()
    } else {
        PathBuf::from(input)
    };

    let _ = ensure_workspace_initialized(&p);
    p
}

/// Recursively scans a workspace directory and builds a hierarchical tree of folders and request files
pub fn scan_workspace_tree(dir: &Path) -> Result<Vec<WorkspaceFileItem>> {
    if !dir.is_dir() {
        return Err(AppError::FsError("Path is not a directory".to_string()));
    }

    let mut items = Vec::new();
    let entries = fs::read_dir(dir)
        .map_err(|e| AppError::FsError(format!("Failed to read directory: {}", e)))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // Skip hidden files/folders (.git, .apiclient, etc.), sidecars (.meta.json), and ignored directories (src, docs, node_modules, etc.)
        if file_name.starts_with('.')
            || file_name.ends_with(".meta.json")
            || IGNORED_NAMES.contains(&file_name.as_str())
        {
            continue;
        }

        if path.is_dir() {
            // Recurse into directory
            let children = scan_workspace_tree(&path)?;
            items.push(WorkspaceFileItem {
                name: file_name,
                path: path.to_string_lossy().to_string(),
                is_dir: true,
                display_name: None,
                method: None,
                children: Some(children),
            });
        } else if file_name.ends_with(".curl") || file_name.ends_with(".grpcurl") {
            let mut display_name = None;
            let mut method = None;

            if let Ok(content) = fs::read_to_string(&path) {
                let (meta, cmd) = extract_comments_and_command(&content);
                display_name = meta.name;

                if file_name.ends_with(".curl") {
                    if let Ok(parsed) = parse_curl_command(&cmd) {
                        method = Some(parsed.method.to_string());
                    }
                } else if file_name.ends_with(".grpcurl") {
                    method = Some("gRPC".to_string());
                }
            }

            items.push(WorkspaceFileItem {
                name: file_name,
                path: path.to_string_lossy().to_string(),
                is_dir: false,
                display_name,
                method,
                children: None,
            });
        }
    }

    // Sort: directories first, then alphabetically
    items.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_workspace() {
        let temp_dir = std::env::temp_dir().join(format!("test_api_client_ws_{}", uuid::Uuid::new_v4()));
        ensure_workspace_initialized(&temp_dir).unwrap();
        let items = scan_workspace_tree(&temp_dir).unwrap();

        // Must find `examples` folder
        let examples = items.iter().find(|i| i.name == "examples" && i.is_dir);
        assert!(examples.is_some(), "Expected 'examples' folder to be scanned in workspace");

        let children = examples.unwrap().children.as_ref().unwrap();
        assert_eq!(children.len(), 5, "Expected 5 sample requests in examples folder");

        let grpc_samples: Vec<_> = children.iter().filter(|i| i.name.ends_with(".grpcurl")).collect();
        assert_eq!(grpc_samples.len(), 2, "Expected 2 .grpcurl sample requests in examples folder");
        assert!(grpc_samples.iter().all(|i| i.method.as_deref() == Some("gRPC")));

        // Must not contain `target`, `icons`, `gen`, or `src-tauri` or `src` or `docs`
        assert!(items.iter().all(|i| i.name != "target" && i.name != "src" && i.name != "docs"));

        // Clean up
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
