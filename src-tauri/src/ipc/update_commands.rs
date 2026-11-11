use tauri::AppHandle;

#[tauri::command]
pub fn relaunch_app(app: AppHandle) {
    app.restart();
}
