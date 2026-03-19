use tauri::AppHandle;
use std::time::Duration;

/// Gateway connection state
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub enum GatewayState {
    Disconnected,
    Connecting,
    Connected,
}

/// Connect to the OpenClaw gateway WebSocket in a loop.
/// Retries up to 3 times on failure, then waits before retrying again.
pub fn connect_loop(handle: AppHandle) {
    let mut retries = 0u32;
    let max_retries = 3;
    let gateway_url = "ws://127.0.0.1:3100/ws";

    loop {
        println!("[gateway] Connecting to {}...", gateway_url);

        match try_connect(gateway_url) {
            Ok(()) => {
                println!("[gateway] Connected successfully");
                retries = 0;
                // TODO: Update tray menu item to "Gateway: Connected"
                // TODO: Handle incoming messages from gateway
                // For now, simulate connection lifecycle
                std::thread::sleep(Duration::from_secs(30));
                println!("[gateway] Connection lost, reconnecting...");
            }
            Err(e) => {
                retries += 1;
                eprintln!("[gateway] Connection failed (attempt {}/{}): {}", retries, max_retries, e);

                if retries >= max_retries {
                    eprintln!("[gateway] Max retries reached. Waiting 60s before next cycle.");
                    std::thread::sleep(Duration::from_secs(60));
                    retries = 0;
                } else {
                    // Exponential backoff: 2s, 4s, 8s
                    let wait = Duration::from_secs(2u64.pow(retries));
                    std::thread::sleep(wait);
                }
            }
        }

        // Keep handle alive to prevent compiler warning
        let _ = &handle;
    }
}

/// Attempt a single WebSocket connection to the gateway.
/// Returns Ok(()) if connection was established (stub for now).
fn try_connect(url: &str) -> Result<(), String> {
    // TODO: Replace with actual WebSocket client (tungstenite or tokio-tungstenite)
    // For now, this is a stub that always fails until gateway is running
    Err(format!("WebSocket client not yet implemented for {}", url))
}
