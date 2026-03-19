use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

mod gateway;

#[tauri::command]
fn get_status() -> String {
    "OpenClaw tray is running".to_string()
}

#[tauri::command]
fn send_gateway_command(method: String, params: String) -> Result<String, String> {
    // TODO: Forward to gateway WebSocket once bidirectional channel is wired
    println!("[tauri-cmd] {} params={}", method, params);
    Ok(format!("{{\"queued\":\"{}\"}}", method))
}

#[tauri::command]
fn get_telemetry() -> Result<serde_json::Value, String> {
    gateway::collect_telemetry()
}

fn position_hud_window(win: &tauri::WebviewWindow, pos: &str) {
    let monitor = win.current_monitor().ok().flatten();
    if let Some(monitor) = monitor {
        let size = monitor.size();
        let w: i32 = 160;
        let h: i32 = 220;
        let margin: i32 = 20;
        let (x, y) = match pos {
            "top-right" => (size.width as i32 - w - margin, margin),
            "bottom-left" => (margin, size.height as i32 - h - margin),
            "bottom-right" => (size.width as i32 - w - margin, size.height as i32 - h - margin),
            _ => (margin, margin), // top-left default
        };
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

#[tauri::command]
fn toggle_hud(app: tauri::AppHandle, position: Option<String>) -> Result<String, String> {
    if let Some(win) = app.get_webview_window("hud") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            Ok("hidden".to_string())
        } else {
            if let Some(ref pos) = position {
                position_hud_window(&win, pos);
            }
            let _ = win.show();
            Ok("visible".to_string())
        }
    } else {
        Err("HUD window not found".to_string())
    }
}

#[tauri::command]
fn set_hud_position(app: tauri::AppHandle, position: String) -> Result<String, String> {
    if let Some(win) = app.get_webview_window("hud") {
        position_hud_window(&win, &position);
        Ok(format!("positioned: {}", position))
    } else {
        Err("HUD window not found".to_string())
    }
}

/// Toggle the dashboard window visibility
fn toggle_dashboard(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("dashboard") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Build tray menu
            let dashboard_item = MenuItem::with_id(app, "dashboard", "Dashboard (Ctrl+Alt+O)", true, None::<&str>)?;
            let separator = MenuItem::with_id(app, "sep", "---", false, None::<&str>)?;
            let gateway_item =
                MenuItem::with_id(app, "gateway", "Gateway: Disconnected", false, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit OpenClaw", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[&dashboard_item, &separator, &gateway_item, &quit_item],
            )?;

            // Create tray icon
            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("OpenClaw AI Assistant")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "rog_status" | "dashboard" => {
                        toggle_dashboard(app);
                    }
                    _ => {}
                })
                .build(app)?;

            // Register global shortcut: Ctrl+Shift+O (OpenClaw)
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

                let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyO);
                match app.global_shortcut().on_shortcut(shortcut, |app, _shortcut, _event| {
                    toggle_dashboard(app);
                }) {
                    Ok(()) => println!("[hotkey] Ctrl+Alt+O registered"),
                    Err(e) => eprintln!("[hotkey] Failed to register: {e}. Continuing without hotkey."),
                }
            }

            // Start gateway connection in background
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                gateway::connect_loop(handle);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_status, send_gateway_command, get_telemetry, toggle_hud, set_hud_position])
        .run(tauri::generate_context!())
        .expect("error while running OpenClaw tray");
}
