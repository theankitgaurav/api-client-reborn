use crate::error::{AppError, Result};
use crate::ipc::types::WorkspaceFileItem;
use crate::parser::comment_meta::extract_comments_and_command;
use crate::parser::curl::parse_curl_command;
use std::fs;
use std::path::{Path, PathBuf};

const IGNORED_NAMES: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "src-tauri",
    "gen",
    "icons",
    ".git",
    ".apiclient",
    ".gemini",
    "environments",
    "tests",
];

/// Resolves workspace root. If "." or empty, and running in dev inside `src-tauri`,
/// steps up to the project root directory.
pub fn resolve_workspace_root(input: &str) -> PathBuf {
    let p = PathBuf::from(input);
    if input == "." || input.is_empty() {
        if let Ok(cwd) = std::env::current_dir() {
            if cwd.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
                return cwd.parent().unwrap_or(&cwd).to_path_buf();
            }
            return cwd;
        }
    }
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

        // Skip hidden files/folders (.git, etc.), sidecars (.meta.json), and ignored build directories
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
        let root = resolve_workspace_root(".");
        let items = scan_workspace_tree(&root).unwrap();

        // Must find `examples` folder
        let examples = items.iter().find(|i| i.name == "examples" && i.is_dir);
        assert!(examples.is_some(), "Expected 'examples' folder to be scanned in workspace");

        let children = examples.unwrap().children.as_ref().unwrap();
        assert_eq!(children.len(), 3, "Expected 3 sample requests in examples folder");

        // Must not contain `target`, `icons`, `gen`, or `src-tauri`
        assert!(items.iter().all(|i| i.name != "target" && i.name != "gen" && i.name != "icons"));
    }
}
