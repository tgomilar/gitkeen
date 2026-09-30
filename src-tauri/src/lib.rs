//! The desktop shell around Gitalia.
//!
//! The Git backend is the same code the development server runs, shipped as a
//! sidecar executable (`binaries/gitalia-backend`). This file starts it with a
//! secret chosen for this run, learns the port it listens on, and forwards
//! every call from the page to it. The secret never reaches the page, so only
//! this process can drive the backend.

use std::sync::{Condvar, Mutex};
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Where the backend listens, once it has said so.
#[derive(Default)]
struct Backend {
    port: Mutex<Option<u16>>,
    ready: Condvar,
    failed: Mutex<Option<String>>,
    secret: Mutex<String>,
    child: Mutex<Option<CommandChild>>,
}

impl Backend {
    /// The port, waiting a few seconds for a backend that is still starting.
    fn wait_for_port(&self) -> Result<u16, String> {
        let guard = self.port.lock().unwrap();
        let (guard, timeout) = self
            .ready
            .wait_timeout_while(guard, Duration::from_secs(20), |p| {
                p.is_none() && self.failed.lock().unwrap().is_none()
            })
            .unwrap();
        if let Some(port) = *guard {
            return Ok(port);
        }
        if let Some(reason) = self.failed.lock().unwrap().clone() {
            return Err(reason);
        }
        if timeout.timed_out() {
            return Err("The Git backend did not start within 20 seconds.".into());
        }
        Err("The Git backend is not running.".into())
    }
}

fn random_secret() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("the system random source is unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Forward one call to the backend. The answer is its envelope as it stands,
/// `{ "result": … }` or `{ "error": … }`, which the page reads the same way it
/// reads the development server's.
#[tauri::command]
async fn git_call(state: tauri::State<'_, Backend>, method: String, args: Value) -> Result<Value, String> {
    let port = state.wait_for_port()?;
    let secret = state.secret.lock().unwrap().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let reply = ureq::post(&format!("http://127.0.0.1:{port}/api/git"))
            .set("x-gitalia-secret", &secret)
            .timeout(Duration::from_secs(600))
            .send_json(json!({ "method": method, "args": args }));
        match reply {
            Ok(res) => res.into_json::<Value>().map_err(|e| format!("The backend sent an answer that is not JSON: {e}")),
            Err(e) => Err(format!("Cannot reach the Git backend: {e}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Write a file the user chose in a save dialog: a patch, or a bundle.
#[tauri::command]
fn save_file(path: String, base64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64)
        .map_err(|e| format!("The file content is not valid: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("Could not write {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Backend::default())
        .invoke_handler(tauri::generate_handler![git_call, save_file])
        .setup(|app| {
            let secret = random_secret();
            let state = app.state::<Backend>();
            *state.secret.lock().unwrap() = secret.clone();

            let (mut events, child) = app
                .shell()
                .sidecar("gitalia-backend")?
                .env("GITALIA_SECRET", secret)
                .spawn()?;
            *state.child.lock().unwrap() = Some(child);

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    let state = handle.state::<Backend>();
                    match event {
                        CommandEvent::Stdout(line) => {
                            let text = String::from_utf8_lossy(&line);
                            if let Some(port) = text.trim().strip_prefix("GITALIA_BACKEND_PORT=") {
                                if let Ok(port) = port.parse::<u16>() {
                                    *state.port.lock().unwrap() = Some(port);
                                    state.ready.notify_all();
                                }
                            }
                        }
                        CommandEvent::Stderr(line) => eprintln!("backend: {}", String::from_utf8_lossy(&line).trim_end()),
                        CommandEvent::Terminated(status) => {
                            *state.port.lock().unwrap() = None;
                            *state.failed.lock().unwrap() =
                                Some(format!("The Git backend stopped (exit code {:?}). Restart Gitalia.", status.code));
                            state.ready.notify_all();
                        }
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Gitalia");

    app.run(|handle, event| {
        // The backend goes when the app does.
        if let RunEvent::Exit = event {
            if let Some(child) = handle.state::<Backend>().child.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
