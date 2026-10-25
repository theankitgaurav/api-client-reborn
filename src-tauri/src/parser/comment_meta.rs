use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct RequestMetadata {
    pub name: Option<String>,
    pub description: Option<String>,
    pub timeout_ms: Option<u64>,
    pub default_env: Option<String>,
    pub tags: Vec<String>,
    pub service: Option<String>,
    pub method: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TestCase {
    pub test_type: String, // e.g. "status_code", "json_path"
    pub expected: serde_json::Value,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct SidecarMetadata {
    pub name: Option<String>,
    pub description: Option<String>,
    pub tests: Vec<TestCase>,
    pub tab_color: Option<String>,
}

/// Parses the leading `# @directive value` comments from the file content.
/// Returns the parsed `RequestMetadata` and the remaining command content.
pub fn extract_comments_and_command(file_content: &str) -> (RequestMetadata, String) {
    let mut meta = RequestMetadata::default();
    let mut command_lines = Vec::new();
    let mut reading_headers = true;

    for line in file_content.lines() {
        let trimmed = line.trim();

        if reading_headers && trimmed.starts_with("# @") {
            let directive_part = &trimmed[3..];
            if let Some((directive, value)) = directive_part.split_once(' ') {
                let directive = directive.trim();
                let value = value.trim().to_string();

                match directive {
                    "name" => meta.name = Some(value),
                    "description" => meta.description = Some(value),
                    "timeout" => {
                        if let Ok(ms) = value.parse::<u64>() {
                            meta.timeout_ms = Some(ms);
                        }
                    }
                    "env" => meta.default_env = Some(value),
                    "tag" | "tags" => {
                        meta.tags = value
                            .split(',')
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect();
                    }
                    "service" => meta.service = Some(value),
                    "method" => meta.method = Some(value),
                    _ => {}
                }
            }
            continue;
        }

        if reading_headers && (trimmed.is_empty() || (trimmed.starts_with('#') && !trimmed.starts_with("# @"))) {
            // General leading comments or blank lines between directives
            if !trimmed.is_empty() && meta.description.is_none() {
                meta.description = Some(trimmed.trim_start_matches('#').trim().to_string());
            }
            continue;
        }

        // First non-comment line encountered: the rest is the executable command
        reading_headers = false;
        command_lines.push(line);
    }

    let command_body = command_lines.join("\n").trim().to_string();
    (meta, command_body)
}

/// Formats the metadata directives into standard `# @...` comments and prepends to command body
pub fn compose_file_content(meta: &RequestMetadata, command_body: &str) -> String {
    let mut lines = Vec::new();

    if let Some(name) = &meta.name {
        lines.push(format!("# @name {}", name));
    }
    if let Some(desc) = &meta.description {
        lines.push(format!("# @description {}", desc));
    }
    if let Some(timeout) = meta.timeout_ms {
        lines.push(format!("# @timeout {}", timeout));
    }
    if let Some(env) = &meta.default_env {
        lines.push(format!("# @env {}", env));
    }
    if !meta.tags.is_empty() {
        lines.push(format!("# @tags {}", meta.tags.join(", ")));
    }
    if let Some(service) = &meta.service {
        lines.push(format!("# @service {}", service));
    }
    if let Some(method) = &meta.method {
        lines.push(format!("# @method {}", method));
    }

    if !lines.is_empty() {
        lines.push("".to_string());
    }

    lines.push(command_body.to_string());
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_and_compose() {
        let content = r#"# @name Get User Details
# @timeout 5000
# @tags auth, user

curl -X GET "https://api.example.com/user""#;

        let (meta, cmd) = extract_comments_and_command(content);
        assert_eq!(meta.name.as_deref(), Some("Get User Details"));
        assert_eq!(meta.timeout_ms, Some(5000));
        assert_eq!(meta.tags, vec!["auth", "user"]);
        assert_eq!(cmd, "curl -X GET \"https://api.example.com/user\"");

        let composed = compose_file_content(&meta, &cmd);
        assert!(composed.contains("# @name Get User Details"));
        assert!(composed.contains("# @timeout 5000"));
        assert!(composed.contains("curl -X GET"));
    }
}
