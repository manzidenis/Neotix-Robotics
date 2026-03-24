use tauri::Manager;

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_app_version])
        .setup(|app| {
            // In Tauri desktop mode, the backend URL is localhost:8000
            // The frontend will use the same API proxy configuration
            let window = app.get_webview_window("main").unwrap();
            window.set_title("Neotix Robotics Platform").unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Neotix Robotics Platform");
}
