use crate::error::{AppError, Result};
use crate::parser::lexer::tokenize_command;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum HttpMethod {
    GET,
    POST,
    PUT,
    DELETE,
    PATCH,
    HEAD,
    OPTIONS,
    CUSTOM(String),
}

impl Default for HttpMethod {
    fn default() -> Self {
        HttpMethod::GET
    }
}

impl From<&str> for HttpMethod {
    fn from(s: &str) -> Self {
        match s.to_uppercase().as_str() {
            "GET" => HttpMethod::GET,
            "POST" => HttpMethod::POST,
            "PUT" => HttpMethod::PUT,
            "DELETE" => HttpMethod::DELETE,
            "PATCH" => HttpMethod::PATCH,
            "HEAD" => HttpMethod::HEAD,
            "OPTIONS" => HttpMethod::OPTIONS,
            other => HttpMethod::CUSTOM(other.to_string()),
        }
    }
}

impl std::fmt::Display for HttpMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HttpMethod::GET => write!(f, "GET"),
            HttpMethod::POST => write!(f, "POST"),
            HttpMethod::PUT => write!(f, "PUT"),
            HttpMethod::DELETE => write!(f, "DELETE"),
            HttpMethod::PATCH => write!(f, "PATCH"),
            HttpMethod::HEAD => write!(f, "HEAD"),
            HttpMethod::OPTIONS => write!(f, "OPTIONS"),
            HttpMethod::CUSTOM(c) => write!(f, "{}", c),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HeaderPair {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BasicAuth {
    pub username: String,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParsedCurlRequest {
    pub method: HttpMethod,
    pub url: String,
    pub headers: Vec<HeaderPair>,
    pub body: Option<String>,
    pub basic_auth: Option<BasicAuth>,
    pub timeout_ms: Option<u64>,
    pub follow_redirects: bool,
    pub insecure: bool,
    pub proxy: Option<String>,
    pub unsupported_flags: Vec<String>,
}

impl Default for ParsedCurlRequest {
    fn default() -> Self {
        Self {
            method: HttpMethod::GET,
            url: String::new(),
            headers: Vec::new(),
            body: None,
            basic_auth: None,
            timeout_ms: Some(30000), // 30s default
            follow_redirects: true,
            insecure: false,
            proxy: None,
            unsupported_flags: Vec::new(),
        }
    }
}

pub fn parse_curl_command(command_text: &str) -> Result<ParsedCurlRequest> {
    let tokens = tokenize_command(command_text)?;
    if tokens.is_empty() {
        return Err(AppError::CurlParserError("Empty command".to_string()));
    }

    let mut iter = tokens.into_iter().peekable();

    // Consume leading 'curl' if present
    if let Some(first) = iter.peek() {
        if first == "curl" {
            iter.next();
        }
    }

    let mut explicit_method: Option<HttpMethod> = None;
    let mut url: Option<String> = None;
    let mut headers = Vec::new();
    let mut body_parts = Vec::new();
    let mut basic_auth = None;
    let mut timeout_ms = None;
    let mut follow_redirects = false;
    let mut insecure = false;
    let mut proxy = None;
    let mut unsupported_flags = Vec::new();

    while let Some(token) = iter.next() {
        match token.as_str() {
            // Method
            "-X" | "--request" => {
                if let Some(m) = iter.next() {
                    explicit_method = Some(HttpMethod::from(m.as_str()));
                }
            }

            // Headers
            "-H" | "--header" => {
                if let Some(h) = iter.next() {
                    if let Some((k, v)) = h.split_once(':') {
                        headers.push(HeaderPair {
                            key: k.trim().to_string(),
                            value: v.trim().to_string(),
                        });
                    }
                }
            }

            // Body Data
            "-d" | "--data" | "--data-raw" | "--data-binary" | "--data-ascii" => {
                if let Some(data) = iter.next() {
                    body_parts.push(data);
                }
            }

            // User / Basic Auth
            "-u" | "--user" => {
                if let Some(u) = iter.next() {
                    if let Some((user, pass)) = u.split_once(':') {
                        basic_auth = Some(BasicAuth {
                            username: user.to_string(),
                            password: Some(pass.to_string()),
                        });
                    } else {
                        basic_auth = Some(BasicAuth {
                            username: u,
                            password: None,
                        });
                    }
                }
            }

            // User-Agent
            "-A" | "--user-agent" => {
                if let Some(ua) = iter.next() {
                    headers.push(HeaderPair {
                        key: "User-Agent".to_string(),
                        value: ua,
                    });
                }
            }

            // Cookie
            "-b" | "--cookie" => {
                if let Some(c) = iter.next() {
                    headers.push(HeaderPair {
                        key: "Cookie".to_string(),
                        value: c,
                    });
                }
            }

            // URL option
            "--url" => {
                if let Some(u) = iter.next() {
                    url = Some(u);
                }
            }

            // Timeout
            "-m" | "--max-time" => {
                if let Some(t) = iter.next() {
                    if let Ok(sec) = t.parse::<f64>() {
                        timeout_ms = Some((sec * 1000.0) as u64);
                    }
                }
            }

            // Insecure
            "-k" | "--insecure" => {
                insecure = true;
            }

            // Follow Redirects
            "-L" | "--location" => {
                follow_redirects = true;
            }

            // Proxy
            "-x" | "--proxy" => {
                if let Some(p) = iter.next() {
                    proxy = Some(p);
                }
            }

            // Standard CLI utility flags that we safely ignore
            "-s" | "--silent" | "-S" | "--show-error" | "-v" | "--verbose" | "-i"
            | "--include" | "--compressed" | "-N" | "--no-buffer" | "-plaintext" => {}

            // Unknown or positional arguments
            arg => {
                if arg.starts_with('-') {
                    unsupported_flags.push(arg.to_string());
                } else if url.is_none() {
                    url = Some(arg.to_string());
                } else {
                    unsupported_flags.push(format!("Unexpected positional argument: {}", arg));
                }
            }
        }
    }

    let url = url.ok_or_else(|| AppError::CurlParserError("Missing URL in cURL command".to_string()))?;

    // If body parts are present, join with '&' if multiple (standard curl behavior)
    let body = if !body_parts.is_empty() {
        Some(body_parts.join("&"))
    } else {
        None
    };

    // Method inference: if body is present and no explicit method set, default to POST
    let method = match explicit_method {
        Some(m) => m,
        None => {
            if body.is_some() {
                HttpMethod::POST
            } else {
                HttpMethod::GET
            }
        }
    };

    Ok(ParsedCurlRequest {
        method,
        url,
        headers,
        body,
        basic_auth,
        timeout_ms: timeout_ms.or(Some(30000)),
        follow_redirects,
        insecure,
        proxy,
        unsupported_flags,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_get() {
        let cmd = "curl https://httpbin.org/get -H 'Accept: application/json'";
        let parsed = parse_curl_command(cmd).unwrap();
        assert_eq!(parsed.method, HttpMethod::GET);
        assert_eq!(parsed.url, "https://httpbin.org/get");
        assert_eq!(parsed.headers.len(), 1);
        assert_eq!(parsed.headers[0].key, "Accept");
        assert_eq!(parsed.headers[0].value, "application/json");
        assert!(parsed.body.is_none());
    }

    #[test]
    fn test_parse_post_with_inferred_method() {
        let cmd = "curl https://httpbin.org/post -d '{\"key\":\"value\"}'";
        let parsed = parse_curl_command(cmd).unwrap();
        assert_eq!(parsed.method, HttpMethod::POST);
        assert_eq!(parsed.body, Some("{\"key\":\"value\"}".to_string()));
    }

    #[test]
    fn test_parse_flags_and_auth() {
        let cmd = "curl -X PUT https://httpbin.org/put -u user:secret -k -L -m 15";
        let parsed = parse_curl_command(cmd).unwrap();
        assert_eq!(parsed.method, HttpMethod::PUT);
        assert_eq!(
            parsed.basic_auth,
            Some(BasicAuth {
                username: "user".to_string(),
                password: Some("secret".to_string())
            })
        );
        assert!(parsed.insecure);
        assert!(parsed.follow_redirects);
        assert_eq!(parsed.timeout_ms, Some(15000));
    }
}
