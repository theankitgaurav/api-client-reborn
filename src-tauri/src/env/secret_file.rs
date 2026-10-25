use crate::error::{AppError, Result};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Loads secret key-values from `.apiclient/.secrets.env` inside the workspace root.
pub fn load_secrets_env(workspace_root: &Path) -> Result<HashMap<String, String>> {
    let secrets_path = workspace_root.join(".apiclient").join(".secrets.env");
    if !secrets_path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&secrets_path)
        .map_err(|e| AppError::FsError(format!("Failed to read .secrets.env: {}", e)))?;

    let mut secrets = HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some((k, v)) = trimmed.split_once('=') {
            let key = k.trim().to_string();
            let mut value = v.trim().to_string();

            // Strip enclosing quotes if present
            if (value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\''))
            {
                if value.len() >= 2 {
                    value = value[1..value.len() - 1].to_string();
                }
            }

            secrets.insert(key, value);
        }
    }

    Ok(secrets)
}

/// Saves secret key-values into `.apiclient/.secrets.env` and ensures .gitignore contains it.
pub fn save_secrets_env(workspace_root: &Path, secrets: &HashMap<String, String>) -> Result<()> {
    let apiclient_dir = workspace_root.join(".apiclient");
    if !apiclient_dir.exists() {
        fs::create_dir_all(&apiclient_dir)
            .map_err(|e| AppError::FsError(format!("Failed to create .apiclient dir: {}", e)))?;
    }

    let secrets_path = apiclient_dir.join(".secrets.env");
    let mut lines = Vec::new();
    lines.push("# Local-only secrets - NEVER commit this file to version control".to_string());
    for (k, v) in secrets {
        lines.push(format!("{}={}", k, v));
    }
    lines.push("".to_string());

    fs::write(&secrets_path, lines.join("\n"))
        .map_err(|e| AppError::FsError(format!("Failed to write .secrets.env: {}", e)))?;

    // Ensure .gitignore has entries
    ensure_gitignore_has_secrets(workspace_root)?;

    Ok(())
}

/// Enforces that `.gitignore` contains rules for secrets isolation
pub fn ensure_gitignore_has_secrets(workspace_root: &Path) -> Result<()> {
    let gitignore_path = workspace_root.join(".gitignore");
    let existing = if gitignore_path.exists() {
        fs::read_to_string(&gitignore_path).unwrap_or_default()
    } else {
        String::new()
    };

    let required_entries = [
        ".apiclient/.secrets.env",
        "*.secret.env",
        "*.secrets.json",
    ];

    let mut to_append = Vec::new();
    for entry in &required_entries {
        if !existing.lines().any(|l| l.trim() == *entry) {
            to_append.push(*entry);
        }
    }

    if !to_append.is_empty() {
        let mut new_content = existing;
        if !new_content.is_empty() && !new_content.ends_with('\n') {
            new_content.push('\n');
        }
        new_content.push_str("\n# API Client Secrets Isolation\n");
        for entry in to_append {
            new_content.push_str(entry);
            new_content.push('\n');
        }

        let _ = fs::write(gitignore_path, new_content);
    }

    Ok(())
}
