use crate::error::{AppError, Result};
use crate::ipc::types::WorkspaceFileItem;
use crate::parser::comment_meta::extract_comments_and_command;
use crate::parser::curl::parse_curl_command;
use std::fs;
use std::path::Path;

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

        // Skip hidden files (.git, .apiclient, etc.) and sidecars (.meta.json)
        if file_name.starts_with('.') || file_name.ends_with(".meta.json") {
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
