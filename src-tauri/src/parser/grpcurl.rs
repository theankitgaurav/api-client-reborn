use crate::engine::grpc::GrpcRequestConfig;
use crate::error::{AppError, Result};
use crate::parser::comment_meta::extract_comments_and_command;
use crate::parser::curl::HeaderPair;
use crate::parser::lexer::tokenize_command;
use serde_json::Value;

/// Parses a `.grpcurl` or `.grpc` request into a structured `GrpcRequestConfig`.
/// Supports:
/// - Direct JSON `.grpc` configurations
/// - Standard grpcurl command line syntax
/// - Comment directives (`# @name`, `# @description`, `# @timeout`, `# @env`)
/// - Metadata flags (`-H "Key: Value"`)
/// - TLS flags (`-plaintext`, `-insecure`, `-cacert`)
/// - Proto and import paths (`-proto`, `-import-path`)
/// - Unary JSON payloads (`-d '{"key": "value"}'`)
/// - Piped client-streaming (`printf '%s\n' '...' '...' | grpcurl -d @ ...`)
pub fn parse_grpc_request(raw_content: &str) -> Result<GrpcRequestConfig> {
    let trimmed = raw_content.trim();
    if trimmed.starts_with('{') {
        if let Ok(config) = serde_json::from_str::<GrpcRequestConfig>(trimmed) {
            return Ok(config);
        }
    }

    let (meta, command) = extract_comments_and_command(raw_content);
    let tokens = tokenize_command(&command)?;

    let grpcurl_index = tokens
        .iter()
        .rposition(|t| t == "grpcurl" || t.ends_with("/grpcurl") || t.ends_with("\\grpcurl"))
        .ok_or_else(|| AppError::GrpcParserError("No grpcurl command was found.".into()))?;

    let mut config = GrpcRequestConfig::default();
    if let Some(name) = meta.name {
        config.name = name;
    }
    if let Some(timeout) = meta.timeout_ms {
        config.timeout_ms = timeout;
    }

    let mut plaintext = false;
    let mut insecure = false;
    let mut ca_file: Option<String> = None;
    let mut proto_file: Option<String> = None;
    let mut import_path: Option<String> = None;
    let mut request_body: Option<String> = None;
    let mut metadata = Vec::new();
    let mut positionals = Vec::new();

    let args = &tokens[grpcurl_index + 1..];
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "|" {
            i += 1;
            continue;
        }

        let (option, inline_val) = if let Some((opt, val)) = arg.split_once('=') {
            (opt, Some(val.to_string()))
        } else {
            (arg.as_str(), None)
        };

        let get_val = |idx: &mut usize| -> Result<String> {
            if let Some(ref val) = inline_val {
                return Ok(val.clone());
            }
            *idx += 1;
            if *idx >= args.len() || args[*idx] == "|" {
                return Err(AppError::GrpcParserError(format!(
                    "Missing value for grpcurl option {option}."
                )));
            }
            Ok(args[*idx].clone())
        };

        match option {
            "-plaintext" => {
                plaintext = true;
                i += 1;
            }
            "-insecure" => {
                insecure = true;
                i += 1;
            }
            "-cacert" => {
                ca_file = Some(get_val(&mut i)?);
                i += 1;
            }
            "-proto" => {
                proto_file = Some(get_val(&mut i)?);
                i += 1;
            }
            "-import-path" => {
                import_path = Some(get_val(&mut i)?);
                i += 1;
            }
            "-d" => {
                request_body = Some(get_val(&mut i)?);
                i += 1;
            }
            "-H" => {
                let header = get_val(&mut i)?;
                let (key, value) = header
                    .split_once(':')
                    .ok_or_else(|| AppError::GrpcParserError(format!("Invalid grpcurl metadata header: {header}")))?;
                metadata.push(HeaderPair {
                    key: key.trim().to_string(),
                    value: value.trim().to_string(),
                });
                i += 1;
            }
            _ => {
                if arg.starts_with('-') {
                    return Err(AppError::GrpcParserError(format!(
                        "Unsupported grpcurl option: {option}"
                    )));
                }
                positionals.push(arg.clone());
                i += 1;
            }
        }
    }

    if positionals.len() != 2 {
        return Err(AppError::GrpcParserError(
            "A grpcurl command must include a target and a fully qualified service/method.".into(),
        ));
    }

    if plaintext && (insecure || ca_file.is_some()) {
        return Err(AppError::GrpcParserError(
            "grpcurl cannot combine -plaintext with TLS certificate options.".into(),
        ));
    }
    if insecure && ca_file.is_some() {
        return Err(AppError::GrpcParserError(
            "grpcurl cannot combine -insecure with -cacert.".into(),
        ));
    }

    let target = positionals[0]
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .trim_end_matches('/');

    let method_path = &positionals[1];
    let slash = method_path
        .rfind('/')
        .filter(|&idx| idx > 0 && idx < method_path.len() - 1)
        .ok_or_else(|| {
            AppError::GrpcParserError(
                "The grpcurl method must be written as package.Service/Method.".into(),
            )
        })?;

    let service = method_path[..slash].to_string();
    let method = method_path[slash + 1..].to_string();

    let tls_enabled = !plaintext;
    config.endpoint = if tls_enabled {
        format!("https://{target}")
    } else {
        format!("http://{target}")
    };
    config.service = service;
    config.method = method;
    config.tls_enabled = tls_enabled;
    config.tls_insecure = insecure;
    config.tls_ca_file = ca_file;
    config.metadata = metadata;

    if let Some(proto) = proto_file {
        config.proto_file = Some(if let Some(import) = import_path {
            if proto.starts_with('/') || proto.contains(':') {
                proto
            } else {
                format!(
                    "{}/{}",
                    import.trim_end_matches('/').trim_end_matches('\\'),
                    proto.trim_start_matches('/').trim_start_matches('\\')
                )
            }
        } else {
            proto
        });
        config.use_reflection = false;
    } else {
        config.proto_file = None;
        config.use_reflection = true;
    }

    // Body parsing: check if printf pipe was used before grpcurl
    let request_json = if let Some(body) = request_body {
        if body == "@" {
            let pipe_idx = tokens[..grpcurl_index]
                .iter()
                .rposition(|t| t == "|")
                .ok_or_else(|| {
                    AppError::GrpcParserError(
                        "Cannot import grpcurl -d @ unless JSON messages are piped with printf.".into(),
                    )
                })?;

            if tokens.is_empty() || tokens[0] != "printf" {
                return Err(AppError::GrpcParserError(
                    "Cannot import grpcurl -d @ unless JSON messages are piped with printf.".into(),
                ));
            }

            // tokens[0] is "printf", tokens[1] is format string e.g. '%s\n', tokens[2..pipe_idx] are messages
            let message_tokens = &tokens[2..pipe_idx];
            if message_tokens.is_empty() {
                return Err(AppError::GrpcParserError(
                    "The printf pipe contains no JSON messages.".into(),
                ));
            }

            let mut parsed_messages = Vec::new();
            for msg in message_tokens {
                let parsed: Value = serde_json::from_str(msg).map_err(|_| {
                    AppError::GrpcParserError("The printf pipe must contain valid JSON messages.".into())
                })?;
                parsed_messages.push(parsed);
            }
            serde_json::to_string_pretty(&parsed_messages)
                .unwrap_or_else(|_| "[]".into())
        } else if body.starts_with('@') {
            return Err(AppError::GrpcParserError(
                "Cannot import grpcurl data from a file; use inline JSON or a printf JSON pipe.".into(),
            ));
        } else {
            // Unary JSON body: try formatting if valid JSON, otherwise leave as-is (e.g. template variables)
            if let Ok(parsed) = serde_json::from_str::<Value>(&body) {
                serde_json::to_string_pretty(&parsed).unwrap_or(body)
            } else {
                body
            }
        }
    } else {
        "{}".to_string()
    };

    config.request_json = request_json;
    if config.name == "New gRPC Request" || config.name.is_empty() {
        config.name = format!("gRPC {}", config.method);
    }

    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_unary_grpcurl() {
        let cmd = r#"grpcurl -plaintext -d '{"greeting":"Hello"}' localhost:50051 demo.Service/SayHello"#;
        let config = parse_grpc_request(cmd).unwrap();
        assert_eq!(config.endpoint, "http://localhost:50051");
        assert_eq!(config.service, "demo.Service");
        assert_eq!(config.method, "SayHello");
        assert_eq!(config.tls_enabled, false);
        assert_eq!(config.use_reflection, true);
        assert!(config.request_json.contains("Hello"));
    }

    #[test]
    fn test_parse_grpcurl_with_metadata_and_tls() {
        let cmd = r#"grpcurl -insecure -H "authorization: Bearer mytoken" -H "x-tenant: 42" api.remote.com:443 package.V1/GetData"#;
        let config = parse_grpc_request(cmd).unwrap();
        assert_eq!(config.endpoint, "https://api.remote.com:443");
        assert_eq!(config.tls_enabled, true);
        assert_eq!(config.tls_insecure, true);
        assert_eq!(config.metadata.len(), 2);
        assert_eq!(config.metadata[0].key, "authorization");
        assert_eq!(config.metadata[0].value, "Bearer mytoken");
        assert_eq!(config.metadata[1].key, "x-tenant");
        assert_eq!(config.metadata[1].value, "42");
    }

    #[test]
    fn test_parse_grpcurl_proto_and_import() {
        let cmd = r#"grpcurl -cacert /certs/ca.pem -import-path protos/v1 -proto service.proto -d '{}' 127.0.0.1:9090 test.TestService/Ping"#;
        let config = parse_grpc_request(cmd).unwrap();
        assert_eq!(config.tls_enabled, true);
        assert_eq!(config.tls_ca_file.as_deref(), Some("/certs/ca.pem"));
        assert_eq!(config.proto_file.as_deref(), Some("protos/v1/service.proto"));
        assert_eq!(config.use_reflection, false);
    }

    #[test]
    fn test_parse_streaming_printf_pipe() {
        let cmd = r#"printf '%s\n' '{"id":1}' '{"id":2}' | grpcurl -plaintext -d @ api.test.com:443 package.Service/Collect"#;
        let config = parse_grpc_request(cmd).unwrap();
        assert_eq!(config.endpoint, "http://api.test.com:443");
        assert_eq!(config.service, "package.Service");
        assert_eq!(config.method, "Collect");
        let parsed: Value = serde_json::from_str(&config.request_json).unwrap();
        let arr = parsed.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["id"], 1);
        assert_eq!(arr[1]["id"], 2);
    }

    #[test]
    fn test_parse_legacy_json_format() {
        let json_str = r#"{
            "name": "Legacy RPC",
            "endpoint": "http://127.0.0.1:50051",
            "service": "demo.DemoService",
            "method": "Echo",
            "request_json": "{\"msg\": \"hello\"}",
            "metadata": [],
            "timeout_ms": 15000,
            "use_reflection": true,
            "tls_enabled": false,
            "tls_insecure": false
        }"#;
        let config = parse_grpc_request(json_str).unwrap();
        assert_eq!(config.name, "Legacy RPC");
        assert_eq!(config.timeout_ms, 15000);
        assert_eq!(config.service, "demo.DemoService");
        assert_eq!(config.method, "Echo");
    }

    #[test]
    fn test_parse_directives() {
        let cmd = "# @name Custom RPC\n# @timeout 12000\ngrpcurl -plaintext -d '{}' localhost:50051 s.S/M";
        let config = parse_grpc_request(cmd).unwrap();
        assert_eq!(config.name, "Custom RPC");
        assert_eq!(config.timeout_ms, 12000);
    }

    #[test]
    fn test_invalid_syntax_errors() {
        assert!(parse_grpc_request("grpcurl -plaintext localhost:50051").is_err());
        assert!(parse_grpc_request("grpcurl -plaintext -d @ localhost:50051 s.S/M").is_err());
        assert!(parse_grpc_request("grpcurl -plaintext -insecure localhost:50051 s.S/M").is_err());
        assert!(parse_grpc_request("grpcurl -insecure -cacert ca.pem localhost:50051 s.S/M").is_err());
    }
}
