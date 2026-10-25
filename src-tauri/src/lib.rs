pub mod engine;
pub mod env;
pub mod error;
pub mod fs;
pub mod ipc;
pub mod parser;

use engine::cancel::CancellationManager;
use ipc::{
    cancel_request, create_request_file, execute_request, get_workspace_environments,
    get_workspace_secrets, parse_curl_preview, read_request_file, save_request_file,
    save_workspace_secrets, scan_workspace,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(CancellationManager::new())
        .invoke_handler(tauri::generate_handler![
            execute_request,
            cancel_request,
            parse_curl_preview,
            scan_workspace,
            read_request_file,
            save_request_file,
            create_request_file,
            get_workspace_environments,
            get_workspace_secrets,
            save_workspace_secrets,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
