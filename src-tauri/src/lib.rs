pub mod engine;
pub mod env;
pub mod error;
pub mod fs;
pub mod ipc;
pub mod parser;

use engine::cancel::CancellationManager;
use tauri::menu::Menu;
#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};
use ipc::{
    append_request_history, cancel_request, clear_request_history, create_collection_folder,
    create_request_file, delete_workspace_item, duplicate_request_file, execute_request,
    execute_grpc_request, discover_grpc_services, export_spooled_stream, get_mcp_config_info, get_request_history, get_workspace_environments, get_workspace_path,
    get_collection_variables, get_collection_variables_for_editor, get_workspace_secrets, get_workspace_variables, import_collection_bundle, parse_curl_preview,
    read_request_file, relaunch_app, rename_workspace_item, save_collection_variables, save_request_file, save_workspace_secrets,
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
        let check_updates_item =
            MenuItem::with_id(app, "check_updates", "Check for Updates…", true, None::<&str>)?;

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
                        &check_updates_item,
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

pub fn run_cli_or_app() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && (args[1] == "mcp" || args[1] == "--mcp") {
        run_mcp_cli(&args[2..]);
        return;
    }
    run();
}

pub fn run_mcp_cli(args: &[String]) {
    let mut workspace = ".".to_string();
    let mut i = 0;
    while i < args.len() {
        if (args[i] == "--workspace" || args[i] == "-w") && i + 1 < args.len() {
            workspace = args[i + 1].clone();
            i += 2;
        } else {
            i += 1;
        }
    }

    let ws_path = std::path::PathBuf::from(&workspace);
    let current_exe = std::env::current_exe().ok();

    // Check candidate locations for bin/mcp.js
    let candidates = [
        ws_path.join("bin").join("mcp.js"),
        ws_path.join("api-client-reborn").join("bin").join("mcp.js"),
        current_exe
            .as_ref()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| p.join("bin").join("mcp.js"))
            .unwrap_or_default(),
    ];

    let mut script_path = None;
    for cand in &candidates {
        if cand.exists() {
            script_path = Some(cand.clone());
            break;
        }
    }

    if let Some(script) = script_path {
        let status = std::process::Command::new("node")
            .arg("--experimental-strip-types")
            .arg(script)
            .args(args)
            .status();

        if let Ok(exit_status) = status {
            std::process::exit(exit_status.code().unwrap_or(0));
        }
    }

    eprintln!("[api-client-reborn-mcp] MCP runner: Node.js runner or bin/mcp.js not found for workspace: {}", workspace);
    eprintln!("[api-client-reborn-mcp] To run via npx: npx -y @api-client-reborn/mcp --workspace {}", workspace);
    std::process::exit(1);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(|app| build_app_menu(app))
        .on_menu_event(|app, event| {
            if event.id() == "check_updates" {
                use tauri::Emitter;
                let _ = app.emit("check-for-updates", ());
            }
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            get_mcp_config_info,
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
            relaunch_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
