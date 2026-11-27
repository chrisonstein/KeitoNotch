//! Commands from outside the app, e.g. Claude via `scripts/keito.ps1`.
//!
//! In: `keito-notch.exe --remote <base64url JSON>`. When the app already runs, the single-instance plugin hands
//! the arguments of that second launch to this one (and ends the second process); on a cold start they're our
//! own arguments. Either way the request is queued and the notch window is pinged; the frontend drains the
//! queue with `take_pending_remote`, does the work through the same store the UI uses, and answers with
//! `remote_reply`, which writes `%LOCALAPPDATA%\ai.keito.notch\remote\<id>.json` for the script to pick up.
//! The queue lives here, not in the web view: a request that arrives while the notch is still loading (or
//! being remounted after a crash) waits until the frontend is ready and asks for it.
//! No network port: only processes of the signed-in Windows user can start the exe or read that folder.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Requests that arrived before the frontend picked them up.
#[derive(Default)]
pub struct Pending(pub Mutex<Vec<String>>);

/// A request is a short JSON object; anything longer is not ours.
const MAX_REQUEST: usize = 8 * 1024;
const MAX_REPLY: usize = 256 * 1024;
const MAX_QUEUE: usize = 20;

/// The value after `--remote` (or `--remote=<value>`), if any.
pub fn request_from_args<S: AsRef<str>>(args: &[S]) -> Option<String> {
    let mut it = args.iter().map(|a| a.as_ref());
    while let Some(a) = it.next() {
        let value = if a == "--remote" {
            it.next()
        } else if let Some(v) = a.strip_prefix("--remote=") {
            Some(v)
        } else {
            continue;
        };
        return value.filter(|v| !v.is_empty() && v.len() <= MAX_REQUEST).map(str::to_string);
    }
    None
}

/// Reply ids become file names, so only a lowercase UUID (8-4-4-4-12 hex): never a path, never a reserved
/// Windows name like `nul`.
pub fn valid_id(id: &str) -> bool {
    let b = id.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, &c)| match i {
            8 | 13 | 18 | 23 => c == b'-',
            _ => c.is_ascii_digit() || (b'a'..=b'f').contains(&c),
        })
}

/// Queues a request and tells the notch window there is something to do.
pub fn deliver(app: &AppHandle, request: String) {
    if let Some(p) = app.try_state::<Pending>() {
        let mut q = p.0.lock().unwrap_or_else(|e| e.into_inner());
        // Nobody picks them up (frontend stuck): keep the newest, the script has long given up on the rest.
        if q.len() >= MAX_QUEUE {
            q.remove(0);
        }
        q.push(request);
    }
    if let Some(w) = app.get_webview_window("notch") {
        let _ = w.emit("remote-command", ());
    }
}

/// The queued requests (base64url JSON), oldest first; empties the queue.
#[tauri::command]
pub fn take_pending_remote(state: tauri::State<'_, Pending>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap_or_else(|e| e.into_inner()))
}

/// Writes the answer for request `id`. Written to a temp file first and renamed, so the script never
/// reads half a reply.
#[tauri::command]
pub async fn remote_reply(app: AppHandle, id: String, json: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("invalid reply id".into());
    }
    if json.len() > MAX_REPLY {
        return Err("reply too large".into());
    }
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("remote");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{id}.json.tmp"));
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(format!("{id}.json"))).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{request_from_args, valid_id};

    #[test]
    fn finds_the_request_in_both_spellings() {
        assert_eq!(request_from_args(&["keito-notch.exe", "--remote", "eyJ2In0"]).as_deref(), Some("eyJ2In0"));
        assert_eq!(request_from_args(&["keito-notch.exe", "--remote=eyJ2In0"]).as_deref(), Some("eyJ2In0"));
    }

    #[test]
    fn no_request_means_a_plain_second_launch() {
        assert_eq!(request_from_args(&["keito-notch.exe"]), None);
        assert_eq!(request_from_args(&["keito-notch.exe", "--remote"]), None);
        assert_eq!(request_from_args(&["keito-notch.exe", "--remote", ""]), None);
        assert_eq!(request_from_args(&["keito-notch.exe".to_string(), "--remote".into(), "x".repeat(9000)]), None);
    }

    #[test]
    fn reply_ids_cannot_leave_the_folder() {
        assert!(valid_id("3f2a9c1e-0b4d-4e8f-9a6b-1c2d3e4f5a6b"));
        for bad in ["", "nul", "../x", "a/b", "a\\b", "x.json", "3F2A9C1E-0B4D-4E8F-9A6B-1C2D3E4F5A6B", "3f2a9c1e-0b4d-4e8f-9a6b-1c2d3e4f5a6", "3f2a9c1e0b4d-4e8f-9a6b-1c2d3e4f5a6bb", "3f2a9c1e-0b4d-4e8f-9a6b-1c2d3e4f5a6g"] {
            assert!(!valid_id(bad), "{bad:?} should be refused");
        }
    }
}
