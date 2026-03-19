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
const PROTOCOL_VERSION: i32 = 3;

/// Load gateway auth token from ~/.openclaw/openclaw.json
fn load_gateway_auth_token() -> Option<String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    let path = std::path::Path::new(&home)
        .join(".openclaw")
        .join("openclaw.json");
    let content = std::fs::read_to_string(path).ok()?;
    let json: Value = serde_json::from_str(&content).ok()?;
    json.pointer("/gateway/auth/token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Build the connect params frame per OpenClaw gateway protocol
fn build_connect_params() -> Value {
    let mut params = json!({
        "minProtocol": PROTOCOL_VERSION,
        "maxProtocol": PROTOCOL_VERSION,
        "client": {
            "id": "gateway-client",
            "displayName": "OpenClaw Tray (Windows)",
            "version": env!("CARGO_PKG_VERSION"),
            "platform": "windows",
            "deviceFamily": "ROG Ally X",
            "mode": "cli"
        },
        "caps": ["tray", "hotkey", "rog-hardware"],
        "locale": "ko-KR"
    });

    if let Some(token) = load_gateway_auth_token() {
        params["auth"] = json!({ "token": token });
        println!("[gateway] Using gateway auth token");
    }

    params
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

// ── PowerShell Execution ──────────────────────────────────────

fn run_powershell(script: &str) -> Result<String, String> {
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| format!("powershell exec failed: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!("powershell error: {stderr}"))
    }
}

// ── Server Request Handler ───────────────────────────────────

fn handle_server_request(method: &str, frame: &Value) -> Result<Value, String> {
    match method {
        "tray.status" => {
            Ok(json!({ "status": "running", "platform": "windows", "version": "0.1.0" }))
        }

        "rog.status" => {
            let raw = run_powershell(
                "$pm = try { (Get-ItemProperty 'HKLM:\\SOFTWARE\\ASUS\\ARMOURY CRATE Service\\ThrottlePlugin\\ROG ATKStatus' -ErrorAction Stop).PowerMode } catch { 'N' }; \
                 $cpu = try { [math]::Round((Get-Counter '\\Processor(_Total)\\% Processor Time' -ErrorAction Stop).CounterSamples[0].CookedValue, 0) } catch { 0 }; \
                 $bat = try { (Get-CimInstance Win32_Battery -ErrorAction Stop).EstimatedChargeRemaining } catch { 'N' }; \
                 \"$pm|$cpu|$bat\""
            )?;
            let parts: Vec<&str> = raw.split('|').collect();
            let pm_map = |v: &str| match v { "0" => "silent", "1" => "performance", "2" => "turbo", _ => "unknown" };
            Ok(json!({
                "powerMode": pm_map(parts.first().unwrap_or(&"N")),
                "cpuPct": parts.get(1).and_then(|s| s.parse::<i32>().ok()).unwrap_or(0),
                "batteryPct": parts.get(2).and_then(|s| s.parse::<i32>().ok()),
            }))
        }

        "rog.setProfile" => {
            let profile = frame.pointer("/params/profile")
                .and_then(|v| v.as_str())
                .ok_or("missing params.profile")?;
            let val = match profile {
                "silent" => "0", "performance" => "1", "turbo" => "2",
                _ => return Err(format!("unknown profile: {profile}")),
            };
            run_powershell(&format!(
                "Set-ItemProperty 'HKLM:\\SOFTWARE\\ASUS\\ARMOURY CRATE Service\\ThrottlePlugin\\ROG ATKStatus' -Name PowerMode -Value {val}"
            ))?;
            Ok(json!({ "applied": profile }))
        }

        "system.exec" => {
            // Execute arbitrary command — requires explicit user approval through gateway
            let script = frame.pointer("/params/script")
                .and_then(|v| v.as_str())
                .ok_or("missing params.script")?;
            // Safety: only allow read-only Get- commands
            if !script.starts_with("Get-") && !script.starts_with("(Get-") {
                return Err("only Get-* commands allowed via system.exec".into());
            }
            let result = run_powershell(script)?;
            Ok(json!({ "output": result }))
        }

        _ => Err(format!("unknown method: {method}")),
    }
}

/// Read a single JSON text frame from the WebSocket.
fn read_json_frame(socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>) -> Result<Value, String> {
    loop {
        let msg = socket.read().map_err(|e| format!("read failed: {e}"))?;
        match msg {
            Message::Text(text) => {
                return serde_json::from_str(&text)
                    .map_err(|e| format!("JSON parse failed: {e}"));
            }
            Message::Ping(data) => {
                let _ = socket.send(Message::Pong(data));
            }
            Message::Close(_) => return Err("connection closed".into()),
            _ => continue,
        }
    }
}

/// Attempt a single WebSocket connection to the gateway.
fn try_connect(url: &str) -> Result<(), String> {
    let (mut socket, _response) = connect(url).map_err(|e| format!("connect failed: {e}"))?;

    // Step 1: Wait for connect.challenge event from server
    println!("[gateway] Waiting for connect.challenge...");
    let challenge = read_json_frame(&mut socket)?;

    let event_type = challenge
        .get("event")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if event_type == "connect.challenge" {
        let nonce = challenge
            .pointer("/payload/nonce")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        println!("[gateway] Got challenge nonce={}", &nonce[..8.min(nonce.len())]);
    } else {
        println!("[gateway] No challenge received (got event={}), continuing anyway", event_type);
    }

    // Step 2: Send connect request frame: { type:"req", method:"connect", params: ConnectParams }
    let connect_frame = json!({
        "type": "req",
        "id": Uuid::new_v4().to_string(),
        "method": "connect",
        "params": build_connect_params()
    });
    socket
        .send(Message::Text(connect_frame.to_string()))
        .map_err(|e| format!("send connect frame failed: {e}"))?;

    println!("[gateway] Connect params sent, waiting for hello-ok...");

    // Step 3: Wait for hello-ok (skip any intermediate events)
    let hello_json = loop {
        let frame = read_json_frame(&mut socket)?;
        match frame.get("type").and_then(|v| v.as_str()) {
            Some("hello-ok") => break frame,
            Some("event") => {
                let ev = frame.get("event").and_then(|v| v.as_str()).unwrap_or("?");
                println!("[gateway] Skipping event during handshake: {}", ev);
                continue;
            }
            Some("res") => {
                // Server responded to our connect request — check if it's an error
                let ok = frame.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                if !ok {
                    let err_msg = frame
                        .pointer("/error/message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown error");
                    let err_code = frame
                        .pointer("/error/code")
                        .and_then(|v| v.as_str())
                        .unwrap_or("?");
                    return Err(format!("connect rejected: [{}] {}", err_code, err_msg));
                }
                // The hello-ok data may be in the payload field or at the top level
                println!("[gateway] Got res ok=true");
                // Extract hello-ok from payload or top-level
                let hello = if let Some(payload) = frame.get("payload") {
                    if payload.get("server").is_some() {
                        payload.clone()
                    } else {
                        frame.clone()
                    }
                } else {
                    frame.clone()
                };
                break hello;
            }
            Some(t) => return Err(format!("unexpected frame during handshake: {}", t)),
            None => continue,
        }
    };

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

                            let res = handle_server_request(method, &frame);
                            let response = json!({
                                "type": "res",
                                "id": id,
                                "ok": res.is_ok(),
                                "payload": match &res {
                                    Ok(v) => v.clone(),
                                    Err(_) => Value::Null,
                                },
                                "error": match &res {
                                    Ok(_) => Value::Null,
                                    Err(e) => json!({ "code": "ERROR", "message": e }),
                                }
                            });
                            let _ = socket.send(Message::Text(response.to_string()));
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
