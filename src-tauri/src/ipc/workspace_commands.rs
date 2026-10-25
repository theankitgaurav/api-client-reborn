use crate::error::{AppError, Result};
use crate::fs::sidecar::{read_sidecar_meta, save_sidecar_meta};
use crate::fs::workspace::scan_workspace_tree;
use crate::ipc::types::WorkspaceFileItem;
use crate::parser::comment_meta::{
    compose_file_content, extract_comments_and_command, RequestMetadata, SidecarMetadata,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct FileDetails {
    pub path: String,
    pub raw_content: String,
    pub metadata: RequestMetadata,
    pub sidecar: Option<SidecarMetadata>,
}

#[tauri::command]
pub fn scan_workspace(workspace_path: String) -> Result<Vec<WorkspaceFileItem>> {
    let path = PathBuf::from(&workspace_path);
    scan_workspace_tree(&path)
}

#[tauri::command]
pub fn read_request_file(file_path: String) -> Result<FileDetails> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(AppError::FsError("File does not exist".to_string()));
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| AppError::FsError(format!("Failed to read file: {}", e)))?;

    let (metadata, _cmd) = extract_comments_and_command(&content);
    let sidecar = read_sidecar_meta(&path);

    Ok(FileDetails {
        path: file_path,
        raw_content: content,
        metadata,
        sidecar,
    })
}

#[tauri::command]
pub fn save_request_file(
    file_path: String,
    raw_content: String,
    sidecar: Option<SidecarMetadata>,
) -> Result<()> {
    let path = PathBuf::from(&file_path);

    fs::write(&path, &raw_content)
        .map_err(|e| AppError::FsError(format!("Failed to write file: {}", e)))?;

    if let Some(sidecar_data) = sidecar {
        save_sidecar_meta(&path, &sidecar_data)?;
    }

    Ok(())
}

#[tauri::command]
pub fn create_request_file(
    parent_dir: String,
    file_name: String,
    template_type: Option<String>,
) -> Result<String> {
    let mut file_name = file_name;
    if !file_name.ends_with(".curl") {
        file_name.push_str(".curl");
    }

    let parent_path = PathBuf::from(&parent_dir);
    if !parent_path.exists() {
        fs::create_dir_all(&parent_path)
            .map_err(|e| AppError::FsError(format!("Failed to create directory: {}", e)))?;
    }

    let target_path = parent_path.join(&file_name);
    if target_path.exists() {
        return Err(AppError::FsError("File already exists".to_string()));
    }

    let initial_name = file_name.trim_end_matches(".curl").replace(['-', '_'], " ");
    let meta = RequestMetadata {
        name: Some(initial_name),
        timeout_ms: Some(30000),
        ..Default::default()
    };

    let command_body = match template_type.as_deref() {
        Some("post") => "curl -X POST \"https://httpbin.org/post\" \\\n  -H \"Content-Type: application/json\" \\\n  -d '{\"message\": \"Hello World\"}'",
        Some("stream") => "curl -N \"https://httpbin.org/stream/20\"",
        _ => "curl -X GET \"https://httpbin.org/get\" \\\n  -H \"Accept: application/json\"",
    };

    let full_content = compose_file_content(&meta, command_body);
    fs::write(&target_path, full_content)
        .map_err(|e| AppError::FsError(format!("Failed to create file: {}", e)))?;

    Ok(target_path.to_string_lossy().to_string())
}
