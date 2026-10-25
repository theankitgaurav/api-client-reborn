use crate::env::secret_file::{load_secrets_env, save_secrets_env};
use crate::error::{AppError, Result};
use crate::ipc::types::EnvironmentItem;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn get_workspace_environments(workspace_path: String) -> Result<Vec<EnvironmentItem>> {
    let ws_path = PathBuf::from(&workspace_path);
    let env_dir = ws_path.join("environments");

    let mut environments = Vec::new();

    if env_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(env_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let file_name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                if file_name.ends_with(".env.json") {
                    let env_name = file_name.trim_end_matches(".env.json").to_string();
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&content) {
                            let mut vars = Vec::new();
                            for (k, v) in map {
                                if let Some(s) = v.as_str() {
                                    vars.push((k, s.to_string()));
                                } else {
                                    vars.push((k, v.to_string()));
                                }
                            }
                            environments.push(EnvironmentItem {
                                name: env_name,
                                file_path: path.to_string_lossy().to_string(),
                                variables: vars,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(environments)
}

#[tauri::command]
pub fn get_workspace_secrets(workspace_path: String) -> Result<HashMap<String, String>> {
    let ws_path = PathBuf::from(&workspace_path);
    load_secrets_env(&ws_path)
}

#[tauri::command]
pub fn save_workspace_secrets(
    workspace_path: String,
    secrets: HashMap<String, String>,
) -> Result<()> {
    let ws_path = PathBuf::from(&workspace_path);
    save_secrets_env(&ws_path, &secrets)
}
