pub mod engine;
pub mod env;
pub mod error;
pub mod fs;
pub mod ipc;
pub mod parser;

use engine::cancel::CancellationManager;
use ipc::{
    cancel_request, create_collection_folder, create_request_file, delete_workspace_item,
    duplicate_request_file, execute_request, get_workspace_environments, get_workspace_path,
    get_workspace_secrets, get_workspace_variables, import_collection_bundle, parse_curl_preview,
    read_request_file, rename_workspace_item, save_request_file, save_workspace_secrets,
    save_workspace_variables, scan_workspace,
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
            get_workspace_path,
            scan_workspace,
            read_request_file,
            save_request_file,
            create_request_file,
            create_collection_folder,
            delete_workspace_item,
            rename_workspace_item,
            duplicate_request_file,
            import_collection_bundle,
            get_workspace_environments,
            get_workspace_secrets,
            save_workspace_secrets,
            get_workspace_variables,
            save_workspace_variables,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
