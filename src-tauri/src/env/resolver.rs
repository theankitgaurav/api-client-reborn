use chrono::Utc;
use rand::Rng;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use uuid::Uuid;

/// Resolves `{{variable}}` templates in the input string using provided variables and dynamic functions.
/// Dynamic built-in variables take precedence during interpolation.
pub fn resolve_variables(template: &str, variables: &HashMap<String, String>) -> String {
    // Regex for {{...}}
    let re = Regex::new(r"\{\{([^}]+)\}\}").unwrap();

    re.replace_all(template, |caps: &regex::Captures| {
        let token = caps[1].trim();

        // 1. Dynamic built-in variables take top precedence during interpolation
        if token == "$uuid" {
            return Uuid::new_v4().to_string();
        }
        if token == "$isoTimestamp" {
            return Utc::now().to_rfc3339();
        }
        if token == "$timestamp" {
            return Utc::now().timestamp().to_string();
        }
        if token.starts_with("$randomInt(") && token.ends_with(')') {
            let inner = &token[11..token.len() - 1];
            if let Some((min_str, max_str)) = inner.split_once(',') {
                if let (Ok(min), Ok(max)) = (min_str.trim().parse::<i64>(), max_str.trim().parse::<i64>()) {
                    if min < max {
                        let mut rng = rand::thread_rng();
                        let val: i64 = rng.gen_range(min..=max);
                        return val.to_string();
                    }
                }
            }
        }

        // 2. User environment & secret variables
        if let Some(val) = variables.get(token) {
            return val.clone();
        }

        // Unresolved: retain the original token
        caps[0].to_string()
    })
    .to_string()
}

/// Resolves variables following strict 5-tier precedence (lowest to highest):
/// 1. environments/default.env.json or legacy workspace.env.json fallback
/// 2. Selected environment, explicitly supplied or from request's @env directive
/// 3. Nearest collection collection_variables.json
/// 4. .apiclient/.secrets.env (canonical secret store - legacy JSON secret stores ignored)
/// 5. Per-call variables map
pub fn resolve_workspace_variables(
    workspace_root: &Path,
    request_path: Option<&Path>,
    explicit_environment: Option<&str>,
    directive_environment: Option<&str>,
    per_call_variables: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut vars = HashMap::new();

    // 1. environments/default.env.json or legacy workspace.env.json fallback
    let default_env = workspace_root.join("environments/default.env.json");
    if default_env.is_file() {
        merge_json_object(&mut vars, &default_env);
    } else {
        let legacy_env = workspace_root.join("workspace.env.json");
        if legacy_env.is_file() {
            merge_json_object(&mut vars, &legacy_env);
        }
    }

    // 2. Selected environment
    let selected_env = explicit_environment
        .filter(|e| !e.trim().is_empty())
        .or_else(|| directive_environment.filter(|e| !e.trim().is_empty()));

    if let Some(env_name) = selected_env {
        let env_file = workspace_root
            .join("environments")
            .join(format!("{}.env.json", env_name.trim()));
        if env_file.is_file() {
            merge_json_object(&mut vars, &env_file);
        }
    }

    // 3. Nearest collection collection_variables.json
    if let Some(req_path) = request_path {
        let full_req_path = if req_path.is_absolute() {
            req_path.to_path_buf()
        } else {
            workspace_root.join(req_path)
        };

        let mut current = full_req_path.parent();
        while let Some(dir) = current {
            let candidate_meta = dir.join(".apiclient/collection_variables.json");
            let candidate_plain = dir.join("collection_variables.json");
            if candidate_meta.is_file() {
                merge_collection_variables_file(&mut vars, &candidate_meta);
                break;
            } else if candidate_plain.is_file() {
                merge_collection_variables_file(&mut vars, &candidate_plain);
                break;
            }
            if dir == workspace_root {
                break;
            }
            current = dir.parent();
        }
    }

    // 4. .apiclient/.secrets.env (canonical secret store; legacy JSON secrets ignored by MCP)
    if let Ok(secrets) = crate::env::secret_file::load_secrets_env(workspace_root) {
        vars.extend(secrets);
    }

    // 5. Per-call variables
    vars.extend(per_call_variables.clone());

    vars
}

fn merge_json_object(target: &mut HashMap<String, String>, path: &Path) {
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(values) = serde_json::from_str::<serde_json::Map<String, Value>>(&raw) {
            for (k, v) in values {
                let s = if let Some(str_val) = v.as_str() {
                    str_val.to_string()
                } else {
                    v.to_string()
                };
                target.insert(k, s);
            }
        }
    }
}

fn merge_collection_variables_file(target: &mut HashMap<String, String>, path: &Path) {
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
            if let Some(obj) = value.as_object() {
                if let Some(public_vars) = obj.get("public_vars").and_then(Value::as_object) {
                    for (k, v) in public_vars {
                        let s = v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string());
                        target.insert(k.clone(), s);
                    }
                } else {
                    for (k, v) in obj {
                        let s = v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string());
                        target.insert(k.clone(), s);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_variable_resolution() {
        let mut vars = HashMap::new();
        vars.insert("base_url".to_string(), "https://api.example.com".to_string());
        vars.insert("user_id".to_string(), "42".to_string());

        let template = "curl {{base_url}}/users/{{user_id}} -H 'Trace: {{$uuid}}'";
        let resolved = resolve_variables(template, &vars);

        assert!(resolved.starts_with("curl https://api.example.com/users/42 -H 'Trace: "));
        assert!(!resolved.contains("{{base_url}}"));
        assert!(!resolved.contains("{{user_id}}"));
        assert!(!resolved.contains("{{$uuid}}"));
    }

    #[test]
    fn test_five_tier_variable_precedence() {
        let dir = std::env::temp_dir().join(format!("test-prec-{}", Uuid::new_v4()));
        fs::create_dir_all(dir.join("environments")).unwrap();
        fs::create_dir_all(dir.join("collections/auth/.apiclient")).unwrap();
        fs::create_dir_all(dir.join(".apiclient")).unwrap();

        // 1. default.env.json
        fs::write(
            dir.join("environments/default.env.json"),
            r#"{"v_tier": "default", "v_default_only": "1", "api_key": "k0"}"#,
        ).unwrap();

        // 2. staging.env.json
        fs::write(
            dir.join("environments/staging.env.json"),
            r#"{"v_tier": "staging", "v_staging_only": "2", "api_key": "k1"}"#,
        ).unwrap();

        // 3. collection_variables.json
        fs::write(
            dir.join("collections/auth/.apiclient/collection_variables.json"),
            r#"{"v_tier": "collection", "v_collection_only": "3", "api_key": "k2"}"#,
        ).unwrap();

        // 4. .apiclient/.secrets.env
        fs::write(
            dir.join(".apiclient/.secrets.env"),
            "v_tier=secrets_env\napi_key=k3\n",
        ).unwrap();

        // Legacy .secrets.json (should be ignored by MCP!)
        fs::write(
            dir.join(".apiclient/.secrets.json"),
            r#"{"legacy_secret": "should_not_exist"}"#,
        ).unwrap();

        let req_path = Path::new("collections/auth/login.curl");

        // Case A: No overrides -> .secrets.env wins for v_tier and api_key
        let vars = resolve_workspace_variables(
            &dir,
            Some(req_path),
            Some("staging"),
            None,
            &HashMap::new(),
        );

        assert_eq!(vars.get("v_tier").map(String::as_str), Some("secrets_env"));
        assert_eq!(vars.get("api_key").map(String::as_str), Some("k3"));
        assert_eq!(vars.get("v_default_only").map(String::as_str), Some("1"));
        assert_eq!(vars.get("v_staging_only").map(String::as_str), Some("2"));
        assert_eq!(vars.get("v_collection_only").map(String::as_str), Some("3"));
        assert_eq!(vars.get("legacy_secret"), None); // Ignored!

        // Case B: Per-call variables override everything
        let mut per_call = HashMap::new();
        per_call.insert("v_tier".to_string(), "per_call".to_string());
        per_call.insert("api_key".to_string(), "k4".to_string());

        let vars2 = resolve_workspace_variables(
            &dir,
            Some(req_path),
            Some("staging"),
            None,
            &per_call,
        );

        assert_eq!(vars2.get("v_tier").map(String::as_str), Some("per_call"));
        assert_eq!(vars2.get("api_key").map(String::as_str), Some("k4"));

        let _ = fs::remove_dir_all(&dir);
    }
}
