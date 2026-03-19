use serde_json::{json, Value};
use std::time::Duration;
use tauri::AppHandle;
use tungstenite::{connect, Message};
use uuid::Uuid;

/// Gateway connection state
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub enum GatewayState {
    Disconnected,
    Connecting,
    Connected,
}

const GATEWAY_URL: &str = "ws://127.0.0.1:3100/ws";
const MAX_RETRIES: u32 = 3;
const PROTOCOL_VERSION: i32 = 1;

/// Build the connect params frame per OpenClaw gateway protocol
fn build_connect_params() -> Value {
    json!({
        "minProtocol": PROTOCOL_VERSION,
        "maxProtocol": PROTOCOL_VERSION,
        "client": {
            "id": "windows-tray",
            "displayName": "OpenClaw Tray (Windows)",
            "version": env!("CARGO_PKG_VERSION"),
            "platform": "windows",
            "deviceFamily": "ROG Ally X",
            "mode": "companion"
        },
        "caps": ["tray", "hotkey", "rog-hardware"],
        "locale": "ko-KR"
    })
}

/// Build a JSON-RPC style request frame
#[allow(dead_code)]
pub fn build_request(method: &str, params: Option<Value>) -> Value {
    json!({
        "type": "req",
        "id": Uuid::new_v4().to_string(),
        "method": method,
        "params": params.unwrap_or(Value::Null)
    })
}

/// Connect to the OpenClaw gateway WebSocket in a loop.
pub fn connect_loop(handle: AppHandle) {
    let mut retries = 0u32;

    loop {
        println!("[gateway] Connecting to {}...", GATEWAY_URL);

        match try_connect(GATEWAY_URL) {
            Ok(()) => {
                println!("[gateway] Session ended, reconnecting...");
                retries = 0;
            }
            Err(e) => {
                retries += 1;
                eprintln!(
                    "[gateway] Connection failed (attempt {}/{}): {}",
                    retries, MAX_RETRIES, e
                );

                if retries >= MAX_RETRIES {
                    eprintln!("[gateway] Max retries reached. Waiting 60s before next cycle.");
                    std::thread::sleep(Duration::from_secs(60));
                    retries = 0;
                } else {
                    let wait = Duration::from_secs(2u64.pow(retries));
                    std::thread::sleep(wait);
                }
            }
        }

        let _ = &handle;
    }
}

/// Attempt a single WebSocket connection to the gateway.
fn try_connect(url: &str) -> Result<(), String> {
    let (mut socket, _response) = connect(url).map_err(|e| format!("connect failed: {e}"))?;

    // Step 1: Send connect params
    let connect_msg = build_connect_params();
    socket
        .send(Message::Text(connect_msg.to_string()))
        .map_err(|e| format!("send connect params failed: {e}"))?;

    println!("[gateway] Connect params sent, waiting for hello-ok...");

    // Step 2: Wait for hello-ok
    let hello = socket
        .read()
        .map_err(|e| format!("read hello-ok failed: {e}"))?;

    let hello_text = match &hello {
        Message::Text(t) => t.clone(),
        _ => return Err("expected text frame for hello-ok".into()),
    };

    let hello_json: Value =
        serde_json::from_str(&hello_text).map_err(|e| format!("parse hello-ok failed: {e}"))?;

    if hello_json.get("type").and_then(|v| v.as_str()) != Some("hello-ok") {
        return Err(format!(
            "unexpected frame type: {}",
            hello_json.get("type").unwrap_or(&Value::Null)
        ));
    }

    let conn_id = hello_json
        .pointer("/server/connId")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let server_version = hello_json
        .pointer("/server/version")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    println!(
        "[gateway] Connected! server={} connId={}",
        server_version, conn_id
    );

    // Step 3: Message loop
    loop {
        let msg = socket
            .read()
            .map_err(|e| format!("read failed: {e}"))?;

        match &msg {
            Message::Text(text) => {
                if let Ok(frame) = serde_json::from_str::<Value>(text) {
                    match frame.get("type").and_then(|v| v.as_str()) {
                        Some("event") => {
                            let event_name = frame
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown");
                            println!("[gateway] Event: {}", event_name);
                        }
                        Some("req") => {
                            // Server-initiated request (e.g. command execution)
                            let method = frame
                                .get("method")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown");
                            let id = frame
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            println!("[gateway] Server request: {} (id={})", method, id);

                            // Send not-implemented response
                            let res = json!({
                                "type": "res",
                                "id": id,
                                "ok": false,
                                "error": {
                                    "code": "NOT_IMPLEMENTED",
                                    "message": format!("tray client does not handle {}", method)
                                }
                            });
                            let _ = socket.send(Message::Text(res.to_string()));
                        }
                        Some("res") => {
                            // Response to our request
                            let id = frame
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let ok = frame
                                .get("ok")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            println!("[gateway] Response id={} ok={}", id, ok);
                        }
                        Some(t) => {
                            println!("[gateway] Unknown frame type: {}", t);
                        }
                        None => {
                            println!("[gateway] Frame without type: {}", text);
                        }
                    }
                }
            }
            Message::Ping(data) => {
                let _ = socket.send(Message::Pong(data.clone()));
            }
            Message::Close(_) => {
                println!("[gateway] Server closed connection");
                break;
            }
            _ => {}
        }
    }

    Ok(())
}
