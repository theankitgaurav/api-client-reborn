pub mod engine;
pub mod env;
pub mod error;
pub mod fs;
pub mod ipc;
pub mod parser;

use engine::cancel::CancellationManager;
use tauri::menu::Menu;
#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};
use ipc::{
    append_request_history, cancel_request, clear_request_history, create_collection_folder,
    create_request_file, delete_workspace_item, duplicate_request_file, execute_request,
    execute_grpc_request, discover_grpc_services, export_spooled_stream, get_request_history, get_workspace_environments, get_workspace_path,
    get_collection_variables, get_collection_variables_for_editor, get_workspace_secrets, get_workspace_variables, import_collection_bundle, parse_curl_preview,
    read_request_file, rename_workspace_item, save_collection_variables, save_request_file, save_workspace_secrets,
    save_workspace_environment, save_workspace_variables, scan_workspace, set_workspace_path,
};

fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    #[cfg(target_os = "macos")]
    {
        let package = app.package_info();
        let about_metadata = AboutMetadata {
            name: Some(package.name.clone()),
            version: Some(package.version.to_string()),
            copyright: Some("Copyright © 2026 Ankit Gaurav".into()),
            credits: Some("Built with ❤️ for developers who love speed, simplicity, and open protocols.".into()),
            ..Default::default()
        };
        let window_menu = Submenu::with_items(
            app,
            "Window",
            true,
            &[
                &PredefinedMenuItem::minimize(app, None)?,
                &PredefinedMenuItem::maximize(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::close_window(app, None)?,
            ],
        )?;
        let help_menu = Submenu::with_items(app, "Help", true, &[])?;

        Menu::with_items(
            app,
            &[
                &Submenu::with_items(
                    app,
                    package.name.clone(),
                    true,
                    &[
                        &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::services(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::hide(app, None)?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, None)?,
                    ],
                )?,
                &Submenu::with_items(
                    app,
                    "File",
                    true,
                    &[&PredefinedMenuItem::close_window(app, None)?],
                )?,
                &Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app, None)?,
                        &PredefinedMenuItem::redo(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::cut(app, None)?,
                        &PredefinedMenuItem::copy(app, None)?,
                        &PredefinedMenuItem::paste(app, None)?,
                        &PredefinedMenuItem::select_all(app, None)?,
                    ],
                )?,
                &Submenu::with_items(
                    app,
                    "View",
                    true,
                    &[&PredefinedMenuItem::fullscreen(app, None)?],
                )?,
                &window_menu,
                &help_menu,
            ],
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        Menu::default(app)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(|app| build_app_menu(app))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(CancellationManager::new())
        .invoke_handler(tauri::generate_handler![
            execute_request,
            execute_grpc_request,
            discover_grpc_services,
            get_request_history,
            append_request_history,
            clear_request_history,
            cancel_request,
            export_spooled_stream,
            parse_curl_preview,
            get_workspace_path,
            set_workspace_path,
            scan_workspace,
            read_request_file,
            save_request_file,
            create_request_file,
            create_collection_folder,
            delete_workspace_item,
            rename_workspace_item,
            duplicate_request_file,
            import_collection_bundle,
            get_collection_variables,
            get_collection_variables_for_editor,
            save_collection_variables,
            get_workspace_environments,
            get_workspace_secrets,
            save_workspace_secrets,
            get_workspace_variables,
            save_workspace_variables,
            save_workspace_environment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
