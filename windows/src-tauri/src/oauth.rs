//! One-shot HTTP listener on 127.0.0.1 that captures Google's OAuth redirect (installed-app flow).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

pub struct Loopback(pub Mutex<Option<TcpListener>>);

/// Binds a free loopback port and returns it (the redirect URI is `http://127.0.0.1:<port>`).
#[tauri::command]
pub fn oauth_listen(state: State<'_, Loopback>) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    *state.0.lock().map_err(|e| e.to_string())? = Some(listener);
    Ok(port)
}

/// Waits (up to `timeout_secs`) for the redirect and returns its query parameters (`code`, `state` or `error`).
#[tauri::command]
pub async fn oauth_wait(state: State<'_, Loopback>, timeout_secs: u64) -> Result<HashMap<String, String>, String> {
    let listener = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("call oauth_listen first")?;
    tauri::async_runtime::spawn_blocking(move || wait(listener, Duration::from_secs(timeout_secs)))
        .await
        .map_err(|e| e.to_string())?
}

fn wait(listener: TcpListener, timeout: Duration) -> Result<HashMap<String, String>, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(params) = handle(stream) {
                    return Ok(params);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("timeout".into())
}

/// Answers one request. Returns the parameters when it was the OAuth callback (browsers also ask for /favicon.ico).
fn handle(mut stream: TcpStream) -> Option<HashMap<String, String>> {
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).ok()?;
    let request = String::from_utf8_lossy(&buf[..n]);
    // "GET /?code=…&state=… HTTP/1.1"
    let target = request.split_whitespace().nth(1).unwrap_or("/");
    let params: HashMap<String, String> = url::Url::parse(&format!("http://127.0.0.1{target}"))
        .map(|u| u.query_pairs().into_owned().collect())
        .unwrap_or_default();
    let is_callback = params.contains_key("code") || params.contains_key("error");
    let body = if is_callback {
        "<html><body style=\"font-family:Segoe UI,system-ui,sans-serif;padding:40px\">\
         <h2>Keito Notch is connected to Google Calendar.</h2><p>You can close this tab.</p></body></html>"
    } else {
        "Not found"
    };
    let status = if is_callback { "200 OK" } else { "404 Not Found" };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    is_callback.then_some(params)
}
