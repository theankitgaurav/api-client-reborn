use crate::engine::cancel::CancellationManager;
use crate::engine::grpc::execute_grpc_request;
use crate::engine::http::execute_http_request;
use crate::env::resolver::resolve_variables;
use crate::error::{AppError, Result};
use crate::ipc::types::ResponseChunk;
use crate::parser::comment_meta::extract_comments_and_command;
use crate::parser::curl::{parse_curl_command, ParsedCurlRequest};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::ipc::Channel;
use tauri::State;

#[tauri::command]
pub async fn execute_request(
    request_id: String,
    raw_content: String,
    variables: HashMap<String, String>,
    channel: Channel<ResponseChunk>,
    cancel_mgr: State<'_, CancellationManager>,
) -> Result<()> {
    // 1. Separate leading comment directives from executable command
    let (_meta, command_body) = extract_comments_and_command(&raw_content);

    // 2. Perform variable interpolation
    let resolved_command = resolve_variables(&command_body, &variables);

    // 3. Register cancellation token
    let cancel_token = cancel_mgr.register(&request_id);

    let req_id_clone = request_id.clone();
    let cancel_mgr_clone = cancel_mgr.inner().clone();

    // 4. Check if gRPC command (starts with grpcurl)
    let trimmed = resolved_command.trim_start();
    if trimmed.starts_with("grpcurl") {
        tokio::spawn(async move {
            let result = execute_grpc_request(
                req_id_clone.clone(),
                resolved_command,
                cancel_token,
                channel,
            )
            .await;
            cancel_mgr_clone.remove(&req_id_clone);
            if let Err(e) = result {
                eprintln!("gRPC Execution error: {:?}", e);
            }
        });
        return Ok(());
    }

    // 5. Otherwise parse as standard cURL command into typed AST
    let parsed = parse_curl_command(&resolved_command)?;

    // 6. Spawn HTTP execution
    tokio::spawn(async move {
        let result = execute_http_request(req_id_clone.clone(), parsed, cancel_token, channel).await;
        cancel_mgr_clone.remove(&req_id_clone);
        if let Err(e) = result {
            eprintln!("Execution error: {:?}", e);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_request(
    request_id: String,
    cancel_mgr: State<'_, CancellationManager>,
) -> Result<bool> {
    Ok(cancel_mgr.cancel(&request_id))
}

#[tauri::command]
pub fn parse_curl_preview(raw_content: String) -> Result<ParsedCurlRequest> {
    let (_meta, command_body) = extract_comments_and_command(&raw_content);
    let trimmed = command_body.trim_start();
    if trimmed.starts_with("grpcurl") {
        let (url_label, headers) = if let Ok(parsed) = crate::engine::grpc::parse_grpc_command(&command_body) {
            let label = if !parsed.host.is_empty() && !parsed.endpoint.is_empty() {
                format!("{} {}", parsed.host, parsed.endpoint)
            } else if !parsed.host.is_empty() {
                parsed.host
            } else {
                "gRPC Service (Reflection / Protobuf)".to_string()
            };
            let h_pairs = parsed
                .headers
                .into_iter()
                .map(|(k, v)| crate::parser::curl::HeaderPair { key: k, value: v })
                .collect();
            (label, h_pairs)
        } else {
            ("gRPC Service (Reflection / Protobuf)".to_string(), Vec::new())
        };

        return Ok(ParsedCurlRequest {
            method: crate::parser::curl::HttpMethod::CUSTOM("gRPC".to_string()),
            url: url_label,
            headers,
            ..Default::default()
        });
    }
    parse_curl_command(&command_body)
}

#[tauri::command]
pub async fn export_spooled_stream(spool_path: String, destination_path: String) -> Result<u64> {
    let src = PathBuf::from(&spool_path);
    let dest = PathBuf::from(&destination_path);

    if !src.exists() {
        return Err(AppError::FsError(format!("Spool file not found: {}", spool_path)));
    }

    if let Some(parent) = dest.parent() {
        if !parent.exists() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::FsError(format!("Failed to create destination directory: {}", e)))?;
        }
    }

    tokio::fs::copy(&src, &dest)
        .await
        .map_err(|e| AppError::FsError(format!("Failed to export stream to destination: {}", e)))
}
