use chrono::Utc;
use rand::Rng;
use regex::Regex;
use std::collections::HashMap;
use uuid::Uuid;

/// Resolves `{{variable}}` templates in the input string using provided variables and dynamic functions.
pub fn resolve_variables(template: &str, variables: &HashMap<String, String>) -> String {
    // Regex for {{...}}
    let re = Regex::new(r"\{\{([^}]+)\}\}").unwrap();

    re.replace_all(template, |caps: &regex::Captures| {
        let token = caps[1].trim();

        // 1. Dynamic built-in variables
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
}
