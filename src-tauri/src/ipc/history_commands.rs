use crate::error::{AppError, Result};
use crate::fs::workspace::resolve_workspace_root;
use crate::ipc::types::RequestHistoryEntry;
use std::fs;
use std::path::PathBuf;

const HISTORY_FILE_NAME: &str = "history.json";

fn history_path(workspace_path: &str) -> PathBuf {
    resolve_workspace_root(workspace_path).join(HISTORY_FILE_NAME)
}

#[tauri::command]
pub fn get_request_history(workspace_path: String) -> Result<Vec<RequestHistoryEntry>> {
    let path = history_path(&workspace_path);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| AppError::FsError(format!("Failed to read request history: {}", e)))?;
    serde_json::from_str(&content)
        .map_err(|e| AppError::FsError(format!("Failed to parse request history: {}", e)))
}

#[tauri::command]
pub fn append_request_history(workspace_path: String, entry: RequestHistoryEntry) -> Result<()> {
    let path = history_path(&workspace_path);
    let mut entries = if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| AppError::FsError(format!("Failed to read request history: {}", e)))?;
        serde_json::from_str::<Vec<RequestHistoryEntry>>(&content)
            .map_err(|e| AppError::FsError(format!("Failed to parse request history: {}", e)))?
    } else {
        Vec::new()
    };

    entries.insert(0, entry);
    let content = serde_json::to_string_pretty(&entries).map_err(|e| {
        AppError::InternalError(format!("Failed to serialize request history: {}", e))
    })?;
    fs::write(&path, content)
        .map_err(|e| AppError::FsError(format!("Failed to save request history: {}", e)))
}

#[tauri::command]
pub fn clear_request_history(workspace_path: String) -> Result<()> {
    let path = history_path(&workspace_path);
    fs::write(&path, "[]")
        .map_err(|e| AppError::FsError(format!("Failed to clear request history: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::curl::HeaderPair;

    fn sample_entry(id: &str) -> RequestHistoryEntry {
        RequestHistoryEntry {
            id: id.to_string(),
            timestamp: "2026-01-01T00:00:00.000Z".to_string(),
            request_name: "Example".to_string(),
            request_path: Some("examples/example.curl".to_string()),
            method: "GET".to_string(),
            url: "https://example.com".to_string(),
            raw_command: "curl https://example.com".to_string(),
            status: Some(200),
            status_text: "OK".to_string(),
            headers: vec![HeaderPair {
                key: "content-type".to_string(),
                value: "application/json".to_string(),
            }],
            response_body: "{}".to_string(),
            duration_ms: Some(10),
            total_bytes: 2,
            is_streaming: false,
            response_file_path: None,
            is_body_truncated: false,
            total_events_count: 0,
            error: None,
        }
    }

    #[test]
    fn history_round_trips_in_workspace_file() {
        let temp_dir = std::env::temp_dir().join(format!("history_test_{}", uuid::Uuid::new_v4()));
        let workspace = temp_dir.to_string_lossy().to_string();

        append_request_history(workspace.clone(), sample_entry("one")).unwrap();
        append_request_history(workspace.clone(), sample_entry("two")).unwrap();
        let entries = get_request_history(workspace).unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "two");
        assert_eq!(entries[1].id, "one");

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn clear_history_writes_empty_list() {
        let temp_dir =
            std::env::temp_dir().join(format!("history_clear_test_{}", uuid::Uuid::new_v4()));
        let workspace = temp_dir.to_string_lossy().to_string();

        append_request_history(workspace.clone(), sample_entry("one")).unwrap();
        clear_request_history(workspace.clone()).unwrap();

        assert!(get_request_history(workspace).unwrap().is_empty());
        let _ = fs::remove_dir_all(temp_dir);
    }
}
