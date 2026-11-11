use crate::error::{AppError, Result};
use crate::env::secret_file::ensure_gitignore_has_secrets;
use crate::fs::sidecar::{read_sidecar_meta, save_sidecar_meta};
use crate::fs::workspace::{app_data_dir, initialize_default_workspace, resolve_workspace_root, scan_workspace_tree, selected_workspace_dir, set_selected_workspace_dir};
use crate::ipc::types::WorkspaceFileItem;
use crate::parser::comment_meta::{
    compose_file_content, extract_comments_and_command, RequestMetadata, SidecarMetadata,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
pub struct FileDetails {
    pub path: String,
    pub raw_content: String,
    pub metadata: RequestMetadata,
    pub sidecar: Option<SidecarMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedFileItem {
    pub relative_path: String,
    pub content: String,
    pub sidecar: Option<SidecarMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportSummary {
    pub imported_requests: usize,
    pub env_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionVariables {
    pub collection_name: String,
    pub public_vars: HashMap<String, String>,
    pub secret_vars: HashMap<String, String>,
}

fn resolve_item_path(input: &str) -> PathBuf {
    let p = PathBuf::from(input);
    if p.is_absolute() {
        p
    } else {
        let root = resolve_workspace_root(".");
        root.join(input)
    }
}

fn slugify(input: &str) -> String {
    let mut slug = String::new();
    let mut last_was_underscore = false;
    for c in input.to_lowercase().chars() {
        if c.is_alphanumeric() {
            slug.push(c);
            last_was_underscore = false;
        } else if !last_was_underscore {
            slug.push('_');
            last_was_underscore = true;
        }
    }
    let trimmed = slug.trim_matches('_');
    if trimmed.is_empty() {
        "collection".to_string()
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
pub fn get_workspace_path() -> Result<String> {
    let path = if app_data_dir().join("settings.json").exists() { selected_workspace_dir() } else { initialize_default_workspace()? };
    Ok(path.to_string_lossy().to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfigInfo {
    pub workspace_path: String,
    pub executable_path: String,
}

#[tauri::command]
pub fn get_mcp_config_info() -> Result<McpConfigInfo> {
    let workspace_path = if app_data_dir().join("settings.json").exists() {
        selected_workspace_dir()
    } else {
        initialize_default_workspace()?
    };
    let executable_path = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "api-client-reborn".to_string());

    Ok(McpConfigInfo {
        workspace_path: workspace_path.to_string_lossy().to_string(),
        executable_path,
    })
}

#[tauri::command]
pub fn set_workspace_path(workspace_path: String) -> Result<String> {
    Ok(set_selected_workspace_dir(&PathBuf::from(workspace_path))?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn scan_workspace(workspace_path: String) -> Result<Vec<WorkspaceFileItem>> {
    let path = resolve_workspace_root(&workspace_path);
    scan_workspace_tree(&path)
}

#[tauri::command]
pub fn read_request_file(file_path: String) -> Result<FileDetails> {
    let mut path = PathBuf::from(&file_path);
    if !path.exists() {
        let root = resolve_workspace_root(".");
        let candidate = root.join(&file_path);
        if candidate.exists() {
            path = candidate;
        } else {
            return Err(AppError::FsError(format!("File does not exist: {}", file_path)));
        }
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| AppError::FsError(format!("Failed to read file: {}", e)))?;

    let (metadata, _cmd) = extract_comments_and_command(&content);
    let sidecar = read_sidecar_meta(&path);

    Ok(FileDetails {
        path: path.to_string_lossy().to_string(),
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
    let path = resolve_item_path(&file_path);

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| AppError::FsError(format!("Failed to create parent folder: {}", e)))?;
        }
    }

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

    let parent_path = if parent_dir.is_empty() || parent_dir == "." {
        resolve_workspace_root(".")
    } else {
        resolve_item_path(&parent_dir)
    };

    if !parent_path.exists() {
        fs::create_dir_all(&parent_path)
            .map_err(|e| AppError::FsError(format!("Failed to create directory: {}", e)))?;
    }

    let target_path = parent_path.join(&file_name);
    if target_path.exists() {
        return Err(AppError::FsError("File already exists".to_string()));
    }

    let initial_name = file_name
        .trim_end_matches(".curl")
        .replace(['-', '_'], " ");

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

#[tauri::command]
pub fn create_collection_folder(parent_path: String, folder_name: String) -> Result<String> {
    let sanitized_name = folder_name.trim().replace(['/', '\\'], "_");
    if sanitized_name.is_empty() {
        return Err(AppError::FsError("Folder name cannot be empty".to_string()));
    }

    let base = if parent_path.is_empty() || parent_path == "." {
        resolve_workspace_root(".")
    } else {
        resolve_item_path(&parent_path)
    };

    let target_path = base.join(sanitized_name);
    if target_path.exists() {
        return Err(AppError::FsError("Folder already exists".to_string()));
    }

    fs::create_dir_all(&target_path)
        .map_err(|e| AppError::FsError(format!("Failed to create folder: {}", e)))?;

    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_workspace_item(item_path: String) -> Result<()> {
    let path = resolve_item_path(&item_path);
    if !path.exists() {
        return Err(AppError::FsError(format!("Item not found: {}", item_path)));
    }

    if path.is_dir() {
        fs::remove_dir_all(&path)
            .map_err(|e| AppError::FsError(format!("Failed to delete folder: {}", e)))?;
    } else {
        fs::remove_file(&path)
            .map_err(|e| AppError::FsError(format!("Failed to delete file: {}", e)))?;

        let sidecar = path.with_extension("meta.json");
        if sidecar.exists() {
            let _ = fs::remove_file(sidecar);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn rename_workspace_item(old_path: String, new_name: String) -> Result<String> {
    let trimmed_name = new_name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::FsError("New name cannot be empty".to_string()));
    }

    let source = resolve_item_path(&old_path);
    if !source.exists() {
        return Err(AppError::FsError(format!("Source does not exist: {}", old_path)));
    }

    let parent = source.parent().unwrap_or_else(|| Path::new("."));

    if source.is_dir() {
        let sanitized_name = trimmed_name.replace(['/', '\\'], "_");
        let target = parent.join(&sanitized_name);

        if target != source && target.exists() {
            return Err(AppError::FsError("An item with the target name already exists".to_string()));
        }

        if target != source {
            fs::rename(&source, &target)
                .map_err(|e| AppError::FsError(format!("Failed to rename folder: {}", e)))?;
        }

        let return_path = if Path::new(&old_path).is_absolute() {
            target.to_string_lossy().to_string()
        } else {
            let old_parent = Path::new(&old_path).parent().unwrap_or_else(|| Path::new(""));
            if old_parent.as_os_str().is_empty() {
                sanitized_name
            } else {
                old_parent.join(&sanitized_name).to_string_lossy().to_string()
            }
        };

        return Ok(return_path);
    }

    // It's a file
    let ext = source.extension().and_then(|s| s.to_str()).unwrap_or("");
    let is_request = ext == "curl" || ext == "grpc" || ext == "grpcurl";

    if is_request {
        let sanitized = trimmed_name.replace(['/', '\\'], "_");
        let suffix = format!(".{ext}");
        let (display_name, target_file_name) = if sanitized.to_lowercase().ends_with(&suffix) {
            let name_without_ext = sanitized[..sanitized.len() - suffix.len()]
                .to_string();
            let file_name = format!("{}.{}", name_without_ext, ext);
            (name_without_ext, file_name)
        } else {
            let slug = slugify(&sanitized);
            let file_name = if !slug.is_empty() {
                format!("{}.{}", slug, ext)
            } else {
                format!("{}.{}", sanitized, ext)
            };
            (sanitized, file_name)
        };

        let target = parent.join(&target_file_name);

        if target != source && target.exists() {
            return Err(AppError::FsError(format!(
                "An item with the name '{}' already exists",
                target_file_name
            )));
        }

        if target != source {
            let old_sidecar = source.with_extension("meta.json");
            fs::rename(&source, &target)
                .map_err(|e| AppError::FsError(format!("Failed to rename file: {}", e)))?;

            if old_sidecar.exists() {
                let new_sidecar = target.with_extension("meta.json");
                let _ = fs::rename(&old_sidecar, &new_sidecar);
            }
        }

        // Update request name using the storage format for this request type.
        if let Ok(content) = fs::read_to_string(&target) {
            let trimmed = content.trim_start();
            if (ext == "grpc" || ext == "grpcurl") && trimmed.starts_with('{') {
                if let Ok(mut config) = serde_json::from_str::<crate::engine::grpc::GrpcRequestConfig>(&content) {
                    config.name = display_name.clone();
                    if let Ok(updated_content) = serde_json::to_string_pretty(&config) {
                        let _ = fs::write(&target, updated_content);
                    }
                }
            } else {
                let (mut meta, cmd) = extract_comments_and_command(&content);
                meta.name = Some(display_name.clone());
                let updated_content = compose_file_content(&meta, &cmd);
                let _ = fs::write(&target, updated_content);
            }
        }

        // Update sidecar metadata name if present
        if let Some(mut sidecar) = read_sidecar_meta(&target) {
            if sidecar.name.is_some() {
                sidecar.name = Some(display_name);
                let _ = save_sidecar_meta(&target, &sidecar);
            }
        }

        let return_path = if Path::new(&old_path).is_absolute() {
            target.to_string_lossy().to_string()
        } else {
            let old_parent = Path::new(&old_path).parent().unwrap_or_else(|| Path::new(""));
            if old_parent.as_os_str().is_empty() {
                target_file_name
            } else {
                old_parent.join(&target_file_name).to_string_lossy().to_string()
            }
        };

        return Ok(return_path);
    }

    // Generic file rename
    let sanitized_name = trimmed_name.replace(['/', '\\'], "_");
    let target = parent.join(&sanitized_name);

    if target != source && target.exists() {
        return Err(AppError::FsError("An item with the target name already exists".to_string()));
    }

    if target != source {
        let old_sidecar = source.with_extension("meta.json");
        fs::rename(&source, &target)
            .map_err(|e| AppError::FsError(format!("Failed to rename file: {}", e)))?;

        if old_sidecar.exists() {
            let new_sidecar = target.with_extension("meta.json");
            let _ = fs::rename(&old_sidecar, &new_sidecar);
        }
    }

    let return_path = if Path::new(&old_path).is_absolute() {
        target.to_string_lossy().to_string()
    } else {
        let old_parent = Path::new(&old_path).parent().unwrap_or_else(|| Path::new(""));
        if old_parent.as_os_str().is_empty() {
            sanitized_name
        } else {
            old_parent.join(&sanitized_name).to_string_lossy().to_string()
        }
    };

    Ok(return_path)
}

#[tauri::command]
pub fn duplicate_request_file(source_path: String) -> Result<String> {
    let source = resolve_item_path(&source_path);
    if !source.exists() || !source.is_file() {
        return Err(AppError::FsError(format!("File does not exist: {}", source_path)));
    }

    let parent = source.parent().unwrap_or_else(|| Path::new("."));
    let file_stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("request");
    let ext = source.extension().and_then(|s| s.to_str()).unwrap_or("curl");

    // Generate unique duplicate filename: e.g. `<stem>_copy.<ext>`
    let mut candidate_name = format!("{}_copy.{}", file_stem, ext);
    let mut counter = 2;
    while parent.join(&candidate_name).exists() {
        candidate_name = format!("{}_copy_{}.{}", file_stem, counter, ext);
        counter += 1;
    }

    let target = parent.join(&candidate_name);
    let content = fs::read_to_string(&source)
        .map_err(|e| AppError::FsError(format!("Failed to read file: {}", e)))?;

    if (ext == "grpc" || ext == "grpcurl") && content.trim_start().starts_with('{') {
        let mut config = serde_json::from_str::<crate::engine::grpc::GrpcRequestConfig>(&content)
            .map_err(|e| AppError::FsError(format!("Invalid gRPC request file: {e}")))?;
        config.name = format!("{} (Copy)", config.name);
        let updated_content = serde_json::to_string_pretty(&config)
            .map_err(|e| AppError::FsError(format!("Could not serialize gRPC request: {e}")))?;
        fs::write(&target, updated_content)
            .map_err(|e| AppError::FsError(format!("Failed to write duplicate file: {e}")))?;
        return Ok(target.to_string_lossy().to_string());
    }

    // Update @name if present
    let (mut meta, cmd) = extract_comments_and_command(&content);
    if let Some(existing_name) = meta.name.take() {
        meta.name = Some(format!("{} (Copy)", existing_name));
    } else {
        meta.name = Some(format!("{} (Copy)", file_stem.replace(['-', '_'], " ")));
    }

    let updated_content = compose_file_content(&meta, &cmd);
    fs::write(&target, updated_content)
        .map_err(|e| AppError::FsError(format!("Failed to write duplicate file: {}", e)))?;

    // Duplicate sidecar if present and update internal "name" attribute to include (Copy)
    let old_sidecar = source.with_extension("meta.json");
    if old_sidecar.exists() {
        let new_sidecar = target.with_extension("meta.json");
        let _ = fs::copy(&old_sidecar, &new_sidecar);

        if let Ok(sidecar_content) = fs::read_to_string(&new_sidecar) {
            if let Ok(mut json_val) = serde_json::from_str::<serde_json::Value>(&sidecar_content) {
                if let Some(obj) = json_val.as_object_mut() {
                    if let Some(name_val) = obj.get("name").and_then(|v| v.as_str()) {
                        obj.insert(
                            "name".to_string(),
                            serde_json::Value::String(format!("{} (Copy)", name_val)),
                        );
                    } else if let Some(req_name) = meta.name.as_ref() {
                        obj.insert(
                            "name".to_string(),
                            serde_json::Value::String(req_name.clone()),
                        );
                    }
                    if let Ok(updated_json) = serde_json::to_string_pretty(&json_val) {
                        let _ = fs::write(&new_sidecar, updated_json);
                    }
                }
            }
        }
    }

    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn import_collection_bundle(
    collection_name: String,
    files: Vec<ImportedFileItem>,
    env_vars: Option<Vec<(String, String)>>,
    secret_vars: Option<Vec<(String, String)>>,
) -> Result<ImportSummary> {
    let root = resolve_workspace_root(".");
    let mut count = 0;
    let collection_root = files.first().and_then(|item| {
        PathBuf::from(item.relative_path.trim_start_matches('/'))
            .components()
            .next()
            .and_then(|component| component.as_os_str().to_str())
            .map(str::to_string)
    }).or_else(|| Some(slugify(&collection_name)));

    for item in files {
        let rel_path = PathBuf::from(item.relative_path.trim_start_matches('/'));
        let target_file = root.join(&rel_path);

        if let Some(parent) = target_file.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|e| AppError::FsError(format!("Failed to create folder: {}", e)))?;
            }
        }

        fs::write(&target_file, &item.content)
            .map_err(|e| AppError::FsError(format!("Failed to write imported file: {}", e)))?;

        if let Some(sidecar) = item.sidecar {
            save_sidecar_meta(&target_file, &sidecar)?;
        }

        count += 1;
    }

    let mut env_file_name = None;
    let vars = env_vars.unwrap_or_default();
    let secret_vars = secret_vars.unwrap_or_default();
    let legacy_collection_env = root
        .join("environments")
        .join(format!("{}.env.json", slugify(&collection_name)));
    if legacy_collection_env.exists() {
        fs::remove_file(legacy_collection_env)
            .map_err(|e| AppError::FsError(format!("Failed to remove legacy collection variables file: {e}")))?;
    }
    if let Some(collection_root) = collection_root {
            let metadata_dir = root.join(collection_root).join(".apiclient");
            fs::create_dir_all(&metadata_dir)
                .map_err(|e| AppError::FsError(format!("Failed to create collection metadata folder: {e}")))?;

            let var_map: HashMap<String, String> = vars.into_iter().collect();
            let variables_path = metadata_dir.join("collection_variables.json");
            if var_map.is_empty() && secret_vars.is_empty() {
                if variables_path.exists() { fs::remove_file(&variables_path)
                    .map_err(|e| AppError::FsError(format!("Failed to clear collection variables: {e}")))?; }
            } else {
                let json = serde_json::to_string_pretty(&var_map)
                    .map_err(|e| AppError::FsError(format!("Serialization error for collection vars: {e}")))?;
                fs::write(&variables_path, json)
                    .map_err(|e| AppError::FsError(format!("Failed to write collection variables: {e}")))?;
            }

            let secrets_path = metadata_dir.join("collection.secrets.json");
            if !secret_vars.is_empty() {
                let secrets: HashMap<String, String> = secret_vars.into_iter().collect();
                let json = serde_json::to_string_pretty(&secrets)
                    .map_err(|e| AppError::FsError(format!("Serialization error for collection secrets: {e}")))?;
                fs::write(&secrets_path, json)
                    .map_err(|e| AppError::FsError(format!("Failed to write collection secrets: {e}")))?;
                ensure_gitignore_has_secrets(&root)?;
            } else if secrets_path.exists() {
                fs::remove_file(&secrets_path)
                    .map_err(|e| AppError::FsError(format!("Failed to clear collection secrets: {e}")))?;
            }
            if !var_map.is_empty() || secrets_path.exists() {
                env_file_name = Some(".apiclient/collection_variables.json".to_string());
            }
    }

    Ok(ImportSummary {
        imported_requests: count,
        env_file: env_file_name,
    })
}

#[tauri::command]
pub fn get_collection_variables(request_file_path: String) -> Result<HashMap<String, String>> {
    let request_path = PathBuf::from(request_file_path);
    let mut directory = request_path.parent();
    while let Some(path) = directory {
        let metadata_dir = path.join(".apiclient");
        let variables_path = metadata_dir.join("collection_variables.json");
        let secrets_path = metadata_dir.join("collection.secrets.json");
        if variables_path.is_file() || secrets_path.is_file() {
            let mut variables = fs::read_to_string(&variables_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<HashMap<String, String>>(&raw).ok())
                .unwrap_or_default();
            if let Ok(raw) = fs::read_to_string(secrets_path) {
                if let Ok(secrets) = serde_json::from_str::<HashMap<String, String>>(&raw) {
                    variables.extend(secrets);
                }
            }
            return Ok(variables);
        }
        directory = path.parent();
    }
    Ok(HashMap::new())
}

fn collection_metadata_dir(request_file_path: &str) -> Result<Option<(PathBuf, String)>> {
    let root = resolve_workspace_root(".");
    let request_path = resolve_item_path(request_file_path);
    let relative = request_path.strip_prefix(&root).map_err(|_| {
        AppError::FsError("Request is outside the active workspace".to_string())
    })?;

    let mut directory = request_path.parent();
    while let Some(path) = directory {
        if path == root {
            break;
        }
        let metadata_dir = path.join(".apiclient");
        if metadata_dir.is_dir()
            && (metadata_dir.join("collection_variables.json").is_file()
                || metadata_dir.join("collection.secrets.json").is_file())
        {
            let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("Collection");
            return Ok(Some((metadata_dir, name.to_string())));
        }
        directory = path.parent();
    }

    let mut components = relative.components();
    let Some(first) = components.next() else {
        return Ok(None);
    };
    let collection_root = root.join(first.as_os_str());
    if !collection_root.is_dir() {
        return Ok(None);
    }
    let name = collection_root.file_name().and_then(|name| name.to_str()).unwrap_or("Collection");
    Ok(Some((collection_root.join(".apiclient"), name.to_string())))
}

#[tauri::command]
pub fn get_collection_variables_for_editor(request_file_path: String) -> Result<Option<CollectionVariables>> {
    let Some((metadata_dir, collection_name)) = collection_metadata_dir(&request_file_path)? else {
        return Ok(None);
    };
    let read_map = |file_name: &str| -> HashMap<String, String> {
        fs::read_to_string(metadata_dir.join(file_name))
            .ok()
            .and_then(|raw| serde_json::from_str::<HashMap<String, String>>(&raw).ok())
            .unwrap_or_default()
    };
    Ok(Some(CollectionVariables {
        collection_name,
        public_vars: read_map("collection_variables.json"),
        secret_vars: read_map("collection.secrets.json"),
    }))
}

#[tauri::command]
pub fn save_collection_variables(
    request_file_path: String,
    public_vars: HashMap<String, String>,
    secret_vars: HashMap<String, String>,
) -> Result<()> {
    let Some((metadata_dir, _)) = collection_metadata_dir(&request_file_path)? else {
        return Err(AppError::FsError("Save this request in a collection to manage collection variables".to_string()));
    };
    fs::create_dir_all(&metadata_dir)
        .map_err(|e| AppError::FsError(format!("Failed to create collection metadata folder: {e}")))?;

    let public_vars = public_vars.into_iter()
        .map(|(key, value)| (key.trim().to_string(), value))
        .filter(|(key, _)| !key.is_empty())
        .collect::<HashMap<_, _>>();
    let secret_vars = secret_vars.into_iter()
        .map(|(key, value)| (key.trim().to_string(), value))
        .filter(|(key, _)| !key.is_empty())
        .collect::<HashMap<_, _>>();

    let variables_path = metadata_dir.join("collection_variables.json");
    if !public_vars.is_empty() || !secret_vars.is_empty() {
        let content = serde_json::to_string_pretty(&public_vars)
            .map_err(|e| AppError::FsError(format!("Failed to serialize collection variables: {e}")))?;
        fs::write(&variables_path, content)
            .map_err(|e| AppError::FsError(format!("Failed to save collection variables: {e}")))?;
    } else if variables_path.exists() {
        fs::remove_file(&variables_path)
            .map_err(|e| AppError::FsError(format!("Failed to remove collection variables: {e}")))?;
    }

    let secrets_path = metadata_dir.join("collection.secrets.json");
    if !secret_vars.is_empty() {
        let content = serde_json::to_string_pretty(&secret_vars)
            .map_err(|e| AppError::FsError(format!("Failed to serialize collection secrets: {e}")))?;
        fs::write(secrets_path, content)
            .map_err(|e| AppError::FsError(format!("Failed to save collection secrets: {e}")))?;
        ensure_gitignore_has_secrets(&resolve_workspace_root("."))?;
    } else if secrets_path.exists() {
        fs::remove_file(&secrets_path)
            .map_err(|e| AppError::FsError(format!("Failed to remove collection secrets: {e}")))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slugify() {
        assert_eq!(slugify("Postman Echo API"), "postman_echo_api");
        assert_eq!(slugify("Special @#$% Characters!"), "special_characters");
        assert_eq!(slugify(""), "collection");
    }

    #[test]
    fn test_rename_workspace_item_request() {
        let temp_dir = std::env::temp_dir().join(format!(
            "test_rename_req_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&temp_dir).unwrap();

        let req_file = temp_dir.join("get_users.curl");
        fs::write(
            &req_file,
            "# @name Get All Users\n# @timeout 5000\n\ncurl https://api.example.com/users",
        )
        .unwrap();

        // 1. Rename with display name
        let result = rename_workspace_item(
            req_file.to_string_lossy().to_string(),
            "List Users".to_string(),
        )
        .unwrap();
        let target = PathBuf::from(&result);
        assert!(target.exists());
        assert_eq!(target.file_name().unwrap(), "list_users.curl");
        assert!(!req_file.exists());

        let content = fs::read_to_string(&target).unwrap();
        assert!(content.contains("# @name List Users"));
        assert!(content.contains("# @timeout 5000"));

        // 2. Rename with explicit .curl filename
        let result2 = rename_workspace_item(
            target.to_string_lossy().to_string(),
            "all_users.curl".to_string(),
        )
        .unwrap();
        let target2 = PathBuf::from(&result2);
        assert!(target2.exists());
        assert_eq!(target2.file_name().unwrap(), "all_users.curl");
        let content2 = fs::read_to_string(&target2).unwrap();
        assert!(content2.contains("# @name all_users"));

        // 3. Rename with same name without failing
        let result3 = rename_workspace_item(
            target2.to_string_lossy().to_string(),
            "all_users".to_string(),
        )
        .unwrap();
        assert!(PathBuf::from(&result3).exists());

        // 4. Test collision error
        let other_file = temp_dir.join("other.curl");
        fs::write(&other_file, "curl https://example.com").unwrap();
        let collision_result = rename_workspace_item(
            other_file.to_string_lossy().to_string(),
            "all_users".to_string(),
        );
        assert!(collision_result.is_err());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_duplicate_request_file_updates_sidecar_name() {
        let temp_dir = std::env::temp_dir().join(format!(
            "test_dup_req_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&temp_dir).unwrap();

        let req_file = temp_dir.join("login.curl");
        fs::write(
            &req_file,
            "# @name Login Request\n\ncurl https://api.example.com/login",
        )
        .unwrap();

        let sidecar_file = temp_dir.join("login.meta.json");
        fs::write(
            &sidecar_file,
            r#"{"name": "Login Request", "tests": [], "description": "Authenticates user"}"#,
        )
        .unwrap();

        let dup_path_str = duplicate_request_file(req_file.to_string_lossy().to_string()).unwrap();
        let dup_path = PathBuf::from(&dup_path_str);
        assert!(dup_path.exists());
        assert_eq!(dup_path.file_name().unwrap(), "login_copy.curl");

        let dup_content = fs::read_to_string(&dup_path).unwrap();
        assert!(dup_content.contains("# @name Login Request (Copy)"));

        let dup_sidecar = dup_path.with_extension("meta.json");
        assert!(dup_sidecar.exists());

        let sidecar_content = fs::read_to_string(&dup_sidecar).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&sidecar_content).unwrap();
        assert_eq!(parsed["name"].as_str().unwrap(), "Login Request (Copy)");
        assert_eq!(parsed["description"].as_str().unwrap(), "Authenticates user");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_save_request_file_resolves_path() {
        let temp_dir = std::env::temp_dir().join(format!(
            "test_save_req_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&temp_dir).unwrap();

        let target_file = temp_dir.join("nested/folder/req.curl");
        save_request_file(
            target_file.to_string_lossy().to_string(),
            "# @name Saved\ncurl https://example.com".to_string(),
            None,
        )
        .unwrap();

        assert!(target_file.exists());
        let content = fs::read_to_string(&target_file).unwrap();
        assert!(content.contains("# @name Saved"));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_delete_workspace_item_removes_request_and_sidecar() {
        let temp_dir = std::env::temp_dir().join(format!(
            "test_delete_req_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&temp_dir).unwrap();

        let req_file = temp_dir.join("delete_me.curl");
        let sidecar_file = temp_dir.join("delete_me.meta.json");
        fs::write(&req_file, "curl https://example.com").unwrap();
        fs::write(&sidecar_file, r#"{"name":"Delete Me","tests":[]}"#).unwrap();

        delete_workspace_item(req_file.to_string_lossy().to_string()).unwrap();

        assert!(!req_file.exists());
        assert!(!sidecar_file.exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
