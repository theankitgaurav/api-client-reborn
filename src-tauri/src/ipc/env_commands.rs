use crate::env::secret_file::{ensure_gitignore_has_secrets, load_secrets_env, save_secrets_env};
use crate::error::{AppError, Result};
use crate::fs::workspace::resolve_workspace_root;
use crate::ipc::types::EnvironmentItem;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceVariablesPayload {
    pub public_vars: HashMap<String, String>,
    pub secret_vars: HashMap<String, String>,
}

#[tauri::command]
pub fn get_workspace_variables(workspace_path: String) -> Result<WorkspaceVariablesPayload> {
    let ws_path = resolve_workspace_root(&workspace_path);
    let env_dir = ws_path.join("environments");

    let mut public_vars = HashMap::new();
    let default_file = env_dir.join("default.env.json");
    let dev_file = env_dir.join("development.env.json");

    let target_file = if default_file.exists() {
        Some(default_file)
    } else if dev_file.exists() {
        Some(dev_file)
    } else {
        None
    };

    if let Some(path) = target_file {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&content) {
                for (k, v) in map {
                    if k == "_environment_name" {
                        continue;
                    }
                    if let Some(s) = v.as_str() {
                        public_vars.insert(k, s.to_string());
                    } else {
                        public_vars.insert(k, v.to_string());
                    }
                }
            }
        }
    }

    let secret_vars = load_secrets_env(&ws_path)?;

    Ok(WorkspaceVariablesPayload {
        public_vars,
        secret_vars,
    })
}

#[tauri::command]
pub fn save_workspace_variables(
    workspace_path: String,
    public_vars: HashMap<String, String>,
    secret_vars: HashMap<String, String>,
) -> Result<()> {
    let ws_path = resolve_workspace_root(&workspace_path);
    let env_dir = ws_path.join("environments");
    if !env_dir.exists() {
        fs::create_dir_all(&env_dir)
            .map_err(|e| AppError::FsError(format!("Failed to create environments dir: {}", e)))?;
    }

    let default_file = env_dir.join("default.env.json");
    let json = serde_json::to_string_pretty(&public_vars)
        .map_err(|e| AppError::FsError(format!("Failed to serialize environment variables: {}", e)))?;
    fs::write(&default_file, json)
        .map_err(|e| AppError::FsError(format!("Failed to write default.env.json: {}", e)))?;

    save_secrets_env(&ws_path, &secret_vars)?;

    Ok(())
}

#[tauri::command]
pub fn get_workspace_environments(workspace_path: String) -> Result<Vec<EnvironmentItem>> {
    let ws_path = resolve_workspace_root(&workspace_path);
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
                            let mut display_name = env_name.clone();
                            for (k, v) in map {
                                if k == "_environment_name" {
                                    if let Some(name) = v.as_str() {
                                        display_name = name.to_string();
                                    }
                                    continue;
                                }
                                if let Some(s) = v.as_str() {
                                    vars.push((k, s.to_string()));
                                } else {
                                    vars.push((k, v.to_string()));
                                }
                            }
                            let secret_path = ws_path
                                .join(".apiclient")
                                .join("environment-secrets")
                                .join(format!("{}.secrets.json", env_name));
                            let secret_vars = fs::read_to_string(secret_path)
                                .ok()
                                .and_then(|raw| serde_json::from_str::<HashMap<String, String>>(&raw).ok())
                                .unwrap_or_default()
                                .into_iter()
                                .collect();
                            environments.push(EnvironmentItem {
                                name: display_name,
                                file_path: path.to_string_lossy().to_string(),
                                variables: vars,
                                secret_variables: secret_vars,
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
pub fn save_workspace_environment(
    workspace_path: String,
    environment_name: String,
    public_vars: HashMap<String, String>,
    secret_vars: HashMap<String, String>,
) -> Result<()> {
    let ws_path = resolve_workspace_root(&workspace_path);
    let env_dir = ws_path.join("environments");
    fs::create_dir_all(&env_dir)
        .map_err(|e| AppError::FsError(format!("Failed to create environments dir: {e}")))?;
    let slug = slugify_environment(&environment_name);
    let mut serialized_vars = public_vars;
    serialized_vars.insert("_environment_name".to_string(), environment_name);
    let content = serde_json::to_string_pretty(&serialized_vars)
        .map_err(|e| AppError::FsError(format!("Failed to serialize environment: {e}")))?;
    fs::write(env_dir.join(format!("{slug}.env.json")), content)
        .map_err(|e| AppError::FsError(format!("Failed to save environment: {e}")))?;

    let secrets_dir = ws_path.join(".apiclient").join("environment-secrets");
    fs::create_dir_all(&secrets_dir)
        .map_err(|e| AppError::FsError(format!("Failed to create environment secrets dir: {e}")))?;
    let secrets_path = secrets_dir.join(format!("{slug}.secrets.json"));
    if secret_vars.is_empty() {
        if secrets_path.exists() {
            fs::remove_file(&secrets_path)
                .map_err(|e| AppError::FsError(format!("Failed to remove environment secrets: {e}")))?;
        }
    } else {
        let secrets = serde_json::to_string_pretty(&secret_vars)
            .map_err(|e| AppError::FsError(format!("Failed to serialize environment secrets: {e}")))?;
        fs::write(secrets_path, secrets)
            .map_err(|e| AppError::FsError(format!("Failed to save environment secrets: {e}")))?;
        ensure_gitignore_has_secrets(&ws_path)?;
    }
    Ok(())
}

fn slugify_environment(name: &str) -> String {
    let mut slug = String::new();
    let mut separator = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_alphanumeric() {
            slug.push(ch);
            separator = false;
        } else if !separator {
            slug.push('_');
            separator = true;
        }
    }
    let slug = slug.trim_matches('_');
    if slug.is_empty() { "environment".to_string() } else { slug.to_string() }
}

#[tauri::command]
pub fn get_workspace_secrets(workspace_path: String) -> Result<HashMap<String, String>> {
    let ws_path = resolve_workspace_root(&workspace_path);
    load_secrets_env(&ws_path)
}

#[tauri::command]
pub fn save_workspace_secrets(
    workspace_path: String,
    secrets: HashMap<String, String>,
) -> Result<()> {
    let ws_path = resolve_workspace_root(&workspace_path);
    save_secrets_env(&ws_path, &secrets)
}
