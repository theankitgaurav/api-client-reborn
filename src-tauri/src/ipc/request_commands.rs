use crate::engine::cancel::CancellationManager;
use crate::engine::http::execute_http_request;
use crate::env::resolver::resolve_variables;
use crate::error::Result;
use crate::ipc::types::ResponseChunk;
use crate::parser::comment_meta::extract_comments_and_command;
use crate::parser::curl::{parse_curl_command, ParsedCurlRequest};
use std::collections::HashMap;
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

    // 3. Parse command into typed AST
    let parsed = parse_curl_command(&resolved_command)?;

    // 4. Register cancellation token
    let cancel_token = cancel_mgr.register(&request_id);

    // 5. Spawn execution
    let req_id_clone = request_id.clone();
    let cancel_mgr_clone = cancel_mgr.inner().clone();

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
    parse_curl_command(&command_body)
}
