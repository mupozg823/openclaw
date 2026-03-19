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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Build tray menu
            let status_item = MenuItem::with_id(app, "status", "OpenClaw AI", true, None::<&str>)?;
            let separator = MenuItem::with_id(app, "sep", "---", false, None::<&str>)?;
            let rog_item = MenuItem::with_id(app, "rog_status", "ROG Status", true, None::<&str>)?;
            let gateway_item =
                MenuItem::with_id(app, "gateway", "Gateway: Disconnected", false, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit OpenClaw", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[&status_item, &separator, &rog_item, &gateway_item, &quit_item],
            )?;

            // Create tray icon
            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("OpenClaw AI Assistant")
                .menu(&menu)
                .menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "rog_status" => {
                        // TODO: Invoke rog-hardware telemetry via gateway
                        println!("ROG status requested");
                    }
                    _ => {}
                })
                .build(app)?;

            // Register global shortcut: Win+Space
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

                let shortcut = Shortcut::new(Some(Modifiers::SUPER), Code::Space);
                app.global_shortcut().on_shortcut(shortcut, |app, _shortcut, _event| {
                    println!("Win+Space triggered — toggle OpenClaw overlay");
                    // TODO: Toggle overlay window or send command to gateway
                    let _ = app;
                })?;
            }

            // Start gateway connection in background
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                gateway::connect_loop(handle);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_status])
        .run(tauri::generate_context!())
        .expect("error while running OpenClaw tray");
}
