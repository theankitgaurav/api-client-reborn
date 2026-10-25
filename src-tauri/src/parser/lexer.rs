use crate::error::{AppError, Result};

/// Splits a raw cURL command string into shell-like tokens according to POSIX rules.
/// Handles:
/// - Single quotes ('...') where content is literal
/// - Double quotes ("...") with escape sequences (\", \$, \\)
/// - Backslash line continuation (e.g. `\` followed by newline)
/// - Stripping leading `#` comments if not inside quotes
pub fn tokenize_command(input: &str) -> Result<Vec<String>> {
    let mut tokens = Vec::new();
    let mut current_token = String::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut escaped = false;
    let mut in_comment = false;

    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let c = chars[i];

        // If inside comment, consume until newline
        if in_comment {
            if c == '\n' {
                in_comment = false;
            }
            i += 1;
            continue;
        }

        if escaped {
            match c {
                '\n' => {
                    // Line continuation: backslash followed by newline is ignored completely
                }
                'n' if in_double_quote => current_token.push('\n'),
                't' if in_double_quote => current_token.push('\t'),
                'r' if in_double_quote => current_token.push('\r'),
                _ => current_token.push(c),
            }
            escaped = false;
            i += 1;
            continue;
        }

        if c == '\\' && !in_single_quote {
            escaped = true;
            i += 1;
            continue;
        }

        if c == '\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
            i += 1;
            continue;
        }

        if c == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
            i += 1;
            continue;
        }

        if !in_single_quote && !in_double_quote {
            if c == '#' && current_token.is_empty() {
                in_comment = true;
                i += 1;
                continue;
            }

            if c.is_whitespace() {
                if !current_token.is_empty() {
                    tokens.push(current_token.clone());
                    current_token.clear();
                }
                i += 1;
                continue;
            }
        }

        current_token.push(c);
        i += 1;
    }

    if in_single_quote || in_double_quote {
        return Err(AppError::LexerError("Unclosed quote in command".to_string()));
    }

    if !current_token.is_empty() {
        tokens.push(current_token);
    }

    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_curl() {
        let cmd = "curl https://api.example.com/users";
        let tokens = tokenize_command(cmd).unwrap();
        assert_eq!(tokens, vec!["curl", "https://api.example.com/users"]);
    }

    #[test]
    fn test_quotes_and_escapes() {
        let cmd = "curl -X POST \"https://api.example.com\" -H 'Content-Type: application/json' -d '{\"foo\": \"bar\"}'";
        let tokens = tokenize_command(cmd).unwrap();
        assert_eq!(
            tokens,
            vec![
                "curl",
                "-X",
                "POST",
                "https://api.example.com",
                "-H",
                "Content-Type: application/json",
                "-d",
                "{\"foo\": \"bar\"}"
            ]
        );
    }

    #[test]
    fn test_multiline_continuation() {
        let cmd = "curl \\\n  -X GET \\\n  https://example.com";
        let tokens = tokenize_command(cmd).unwrap();
        assert_eq!(tokens, vec!["curl", "-X", "GET", "https://example.com"]);
    }
}
