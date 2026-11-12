use crate::error::{AppError, Result};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Parses `KEY=VALUE` entries from `.secrets.env` format.
/// Supports:
/// - Comments starting with `#` and blank lines
/// - Single and double quoted values
/// - Preserves inner `#` when inside quotes
/// - Strips trailing inline comments when unquoted
/// - Duplicate keys use the last definition
pub fn parse_secrets_env_content(content: &str) -> HashMap<String, String> {
    let mut secrets = HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some((k, v)) = trimmed.split_once('=') {
            let key = k.trim().to_string();
            let val_trimmed = v.trim();

            let value = if val_trimmed.starts_with('"') {
                // Double quoted value
                if let Some(end_quote) = find_closing_quote(val_trimmed, '"') {
                    unescape_double_quotes(&val_trimmed[1..end_quote])
                } else {
                    val_trimmed.trim_matches('"').to_string()
                }
            } else if val_trimmed.starts_with('\'') {
                // Single quoted value
                if let Some(end_quote) = find_closing_quote(val_trimmed, '\'') {
                    val_trimmed[1..end_quote].to_string()
                } else {
                    val_trimmed.trim_matches('\'').to_string()
                }
            } else {
                // Unquoted value: strip trailing inline comments
                if let Some(comment_idx) = val_trimmed.find(" #") {
                    val_trimmed[..comment_idx].trim().to_string()
                } else if let Some(comment_idx) = val_trimmed.find('\t').and_then(|t| {
                    if val_trimmed[t..].trim_start().starts_with('#') {
                        Some(t)
                    } else {
                        None
                    }
                }) {
                    val_trimmed[..comment_idx].trim().to_string()
                } else {
                    val_trimmed.to_string()
                }
            };

            secrets.insert(key, value);
        }
    }
    secrets
}

fn find_closing_quote(s: &str, quote_char: char) -> Option<usize> {
    let mut escaped = false;
    for (i, c) in s.char_indices().skip(1) {
        if escaped {
            escaped = false;
            continue;
        }
        if c == '\\' && quote_char == '"' {
            escaped = true;
            continue;
        }
        if c == quote_char {
            return Some(i);
        }
    }
    None
}

fn unescape_double_quotes(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(next) = chars.next() {
                match next {
                    'n' => out.push('\n'),
                    'r' => out.push('\r'),
                    't' => out.push('\t'),
                    '\\' => out.push('\\'),
                    '"' => out.push('"'),
                    _ => {
                        out.push('\\');
                        out.push(next);
                    }
                }
            } else {
                out.push('\\');
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Loads secret key-values from `.apiclient/.secrets.env` inside the workspace root.
pub fn load_secrets_env(workspace_root: &Path) -> Result<HashMap<String, String>> {
    let secrets_path = workspace_root.join(".apiclient").join(".secrets.env");
    if !secrets_path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&secrets_path)
        .map_err(|e| AppError::FsError(format!("Failed to read .secrets.env: {}", e)))?;

    Ok(parse_secrets_env_content(&content))
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
        fs::write(&gitignore_path, new_content)
            .map_err(|e| AppError::FsError(format!("Failed to update .gitignore: {}", e)))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_secrets_env_comments_and_quotes() {
        let content = r#"
# Comment at the top
API_KEY=plain_key
SECRET_TOKEN="my_secret_token"
QUOTED_HASH="pass#word#123" # trailing comment
SINGLE_QUOTED='single#value#here' # trailing comment
UNQUOTED_TRAIL=my_val # inline comment
DUPLICATE=first
DUPLICATE=second
"#;
        let secrets = parse_secrets_env_content(content);
        assert_eq!(secrets.get("API_KEY").map(String::as_str), Some("plain_key"));
        assert_eq!(secrets.get("SECRET_TOKEN").map(String::as_str), Some("my_secret_token"));
        assert_eq!(secrets.get("QUOTED_HASH").map(String::as_str), Some("pass#word#123"));
        assert_eq!(secrets.get("SINGLE_QUOTED").map(String::as_str), Some("single#value#here"));
        assert_eq!(secrets.get("UNQUOTED_TRAIL").map(String::as_str), Some("my_val"));
        assert_eq!(secrets.get("DUPLICATE").map(String::as_str), Some("second"));
    }
}
