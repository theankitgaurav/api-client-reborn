use crate::error::{AppError, Result};
use crate::fs::sidecar::{read_sidecar_meta, save_sidecar_meta};
use crate::fs::workspace::{resolve_workspace_root, scan_workspace_tree, IGNORED_NAMES};
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
    let path = resolve_workspace_root(".");
    Ok(path.to_string_lossy().to_string())
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
    if !file_name.ends_with(".curl") && !file_name.ends_with(".grpcurl") {
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
        .trim_end_matches(".grpcurl")
        .replace(['-', '_'], " ");

    let meta = RequestMetadata {
        name: Some(initial_name),
        timeout_ms: Some(30000),
        ..Default::default()
    };

    let command_body = match template_type.as_deref() {
        Some("post") => "curl -X POST \"https://httpbin.org/post\" \\\n  -H \"Content-Type: application/json\" \\\n  -d '{\"message\": \"Hello World\"}'",
        Some("stream") => "curl -N \"https://httpbin.org/stream/20\"",
        Some("grpc") => "grpcurl -plaintext -d '{\"id\": 1}' localhost:50051 api.v1.UserService/GetUser",
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
    let is_request = ext == "curl" || ext == "grpcurl";

    if is_request {
        let sanitized = trimmed_name.replace(['/', '\\'], "_");
        let (display_name, target_file_name) = if sanitized.ends_with(".curl") || sanitized.ends_with(".grpcurl") {
            let name_without_ext = sanitized
                .trim_end_matches(".curl")
                .trim_end_matches(".grpcurl")
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

        // Update @name in the target file content
        if let Ok(content) = fs::read_to_string(&target) {
            let (mut meta, cmd) = extract_comments_and_command(&content);
            meta.name = Some(display_name.clone());
            let updated_content = compose_file_content(&meta, &cmd);
            let _ = fs::write(&target, updated_content);
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
) -> Result<ImportSummary> {
    let root = resolve_workspace_root(".");
    let mut count = 0;

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
    if let Some(vars) = env_vars {
        if !vars.is_empty() {
            let env_dir = root.join("environments");
            if !env_dir.exists() {
                fs::create_dir_all(&env_dir)
                    .map_err(|e| AppError::FsError(format!("Failed to create environments folder: {}", e)))?;
            }

            let slug = slugify(&collection_name);
            let filename = format!("{}.env.json", slug);
            let target_env = env_dir.join(&filename);

            let mut var_map: HashMap<String, String> = HashMap::new();
            for (k, v) in vars {
                var_map.insert(k, v);
            }

            let json = serde_json::to_string_pretty(&var_map)
                .map_err(|e| AppError::FsError(format!("Serialization error for env vars: {}", e)))?;

            fs::write(&target_env, json)
                .map_err(|e| AppError::FsError(format!("Failed to write env file: {}", e)))?;

            env_file_name = Some(filename);
        }
    }

    Ok(ImportSummary {
        imported_requests: count,
        env_file: env_file_name,
    })
}

#[tauri::command]
pub async fn get_workspace_proto_files(workspace_path: Option<String>) -> Result<Vec<String>> {
    tokio::task::spawn_blocking(move || {
        let ws_root = match workspace_path.as_deref() {
            Some(p) if !p.is_empty() && p != "." => resolve_workspace_root(p),
            _ => resolve_workspace_root("."),
        };

        let mut results = Vec::new();

        fn scan_protos(dir: &Path, base: &Path, depth: usize, results: &mut Vec<String>) {
            if depth > 5 || results.len() >= 100 {
                return;
            }
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    // Skip symlinks to completely prevent infinite directory cycles
                    if entry.file_type().map(|ft| ft.is_symlink()).unwrap_or(false) {
                        continue;
                    }
                    let path = entry.path();
                    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if file_name.starts_with('.') || IGNORED_NAMES.contains(&file_name) {
                        continue;
                    }
                    if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                        scan_protos(&path, base, depth + 1, results);
                    } else if file_name.ends_with(".proto") {
                        let rel_str = if let Ok(rel) = path.strip_prefix(base) {
                            rel.to_string_lossy().replace('\\', "/")
                        } else {
                            path.to_string_lossy().replace('\\', "/")
                        };
                        results.push(rel_str);
                    }
                }
            }
        }

        scan_protos(&ws_root, &ws_root, 0, &mut results);

        results.sort();
        results.dedup();
        Ok(results)
    })
    .await
    .map_err(|e| AppError::InternalError(format!("Failed to scan proto files: {}", e)))?
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

    #[tokio::test]
    async fn test_get_workspace_proto_files_bounded_and_safe() {
        let temp_dir = std::env::temp_dir().join(format!("proto_scan_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();
        let protos_dir = temp_dir.join("protos");
        fs::create_dir_all(&protos_dir).unwrap();
        fs::write(protos_dir.join("service.proto"), "syntax = \"proto3\";").unwrap();

        let res = get_workspace_proto_files(Some(temp_dir.to_string_lossy().to_string())).await.unwrap();
        assert!(res.contains(&"protos/service.proto".to_string()));
        assert!(res.contains(&"examples/user.proto".to_string()));

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
