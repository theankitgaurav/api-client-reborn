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
  "tenant_id": "dev-tenant-101"
}"#;

const DEFAULT_PROD_ENV: &str = r#"{
  "api_host": "api.example.com",
  "port": "443",
  "base_url": "https://api.example.com",
  "tenant_id": "prod-enterprise"
}"#;

const LEGACY_SSE_EXAMPLE: &str = "# @name SSE - Live Demo Events\n# @description Connects to a public SSE demo. Let a few events arrive, then press Cancel to close the live stream.\n# @timeout 60000\n\ncurl -N \"https://sse.dev/test\" \\\n  -H \"Accept: text/event-stream\"\n";

const STARTER_EXAMPLES: &[(&str, &str)] = &[
    ("get_users.curl", include_str!("../../../examples/get_users.curl")),
    ("create_user.curl", include_str!("../../../examples/create_user.curl")),
    ("stream_events.curl", include_str!("../../../examples/stream_events.curl")),
    ("methods/put_user.curl", include_str!("../../../examples/methods/put_user.curl")),
    ("methods/patch_user.curl", include_str!("../../../examples/methods/patch_user.curl")),
    ("methods/delete_user.curl", include_str!("../../../examples/methods/delete_user.curl")),
    ("methods/head_request.curl", include_str!("../../../examples/methods/head_request.curl")),
    ("methods/options_request.curl", include_str!("../../../examples/methods/options_request.curl")),
    ("auth/basic_auth.curl", include_str!("../../../examples/auth/basic_auth.curl")),
    ("auth/bearer_auth.curl", include_str!("../../../examples/auth/bearer_auth.curl")),
    ("responses/status_404.curl", include_str!("../../../examples/responses/status_404.curl")),
    ("responses/inspect_redirect.curl", include_str!("../../../examples/responses/inspect_redirect.curl")),
    ("responses/follow_redirect.curl", include_str!("../../../examples/responses/follow_redirect.curl")),
    ("responses/timeout_test.curl", include_str!("../../../examples/responses/timeout_test.curl")),
    (
        "scripting/pre_post_scripts.curl",
        include_str!("../../../examples/scripting/pre_post_scripts.curl"),
    ),
    (
        "scripting/pre_post_scripts.meta.json",
        include_str!("../../../examples/scripting/pre_post_scripts.meta.json"),
    ),
    ("streaming/sse_events.curl", include_str!("../../../examples/streaming/sse_events.curl")),
];

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

    // 3. Seed starter requests in examples/
    let examples_dir = dir.join("examples");
    let _ = fs::create_dir_all(&examples_dir);

    for (name, content) in STARTER_EXAMPLES {
        let path = examples_dir.join(name);
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let is_unchanged_legacy_sse_example = *name == "streaming/sse_events.curl"
            && fs::read_to_string(&path)
                .map(|existing| existing == LEGACY_SSE_EXAMPLE)
                .unwrap_or(false);
        if !path.exists() || is_unchanged_legacy_sse_example {
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
        } else if file_name.ends_with(".curl") {
            let mut display_name = None;
            let mut method = None;

            if let Ok(content) = fs::read_to_string(&path) {
                let (meta, cmd) = extract_comments_and_command(&content);
                display_name = meta.name;

                if let Ok(parsed) = parse_curl_command(&cmd) {
                    method = Some(parsed.method.to_string());
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

    fn count_requests(items: &[WorkspaceFileItem]) -> usize {
        items
            .iter()
            .map(|item| {
                if item.is_dir {
                    count_requests(item.children.as_deref().unwrap_or_default())
                } else {
                    1
                }
            })
            .sum()
    }

    #[test]
    fn test_scan_workspace() {
        let temp_dir = std::env::temp_dir().join(format!("test_api_client_ws_{}", uuid::Uuid::new_v4()));
        ensure_workspace_initialized(&temp_dir).unwrap();
        let items = scan_workspace_tree(&temp_dir).unwrap();

        // Must find `examples` folder
        let examples = items.iter().find(|i| i.name == "examples" && i.is_dir);
        assert!(examples.is_some(), "Expected 'examples' folder to be scanned in workspace");

        let children = examples.unwrap().children.as_ref().unwrap();
        assert_eq!(count_requests(children), 16, "Expected all manual test requests in examples folder");

        // Must not contain `target`, `icons`, `gen`, or `src-tauri` or `src` or `docs`
        assert!(items.iter().all(|i| i.name != "target" && i.name != "src" && i.name != "docs"));

        // Clean up
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
