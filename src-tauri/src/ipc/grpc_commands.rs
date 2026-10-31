use crate::engine::cancel::CancellationManager;
use crate::engine::grpc::{discover_grpc_services as discover, execute_grpc_request as run, GrpcRequestConfig, GrpcServiceInfo};
use crate::error::Result;
use crate::ipc::types::ResponseChunk;
use std::path::PathBuf;
use tauri::ipc::Channel;
use tauri::State;

#[tauri::command]
pub async fn discover_grpc_services(config: GrpcRequestConfig) -> Result<Vec<GrpcServiceInfo>> {
    discover(config).await
}

#[tauri::command]
pub async fn execute_grpc_request(
    request_id: String,
    config: GrpcRequestConfig,
    workspace_path: Option<String>,
    channel: Channel<ResponseChunk>,
    cancel_mgr: State<'_, CancellationManager>,
) -> Result<()> {
    let cancel_token = cancel_mgr.register(&request_id);
    let manager = cancel_mgr.inner().clone();
    let request_id_for_task = request_id.clone();
    let root = workspace_path.map(PathBuf::from);

    tokio::spawn(async move {
        let _ = run(request_id_for_task.clone(), config, channel, cancel_token, root).await;
        manager.remove(&request_id_for_task);
    });
    Ok(())
}
