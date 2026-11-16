//! MA Tarjimon backend.
//!
//! Runs a bundled llama.cpp `llama-server` (from `resources/llama/`) on a free local port
//! with the .gguf model the user picked, and sends it TranslateGemma-format prompts.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Manager, RunEvent, State};

struct Engine {
    child: Child,
    port: u16,
}

#[derive(Default)]
struct EngineState(Mutex<Option<Engine>>);

fn lang_name(code: &str) -> Result<&'static str, String> {
    match code {
        "en" => Ok("English"),
        "uz" => Ok("Uzbek"),
        other => Err(format!("Noma'lum til kodi: {other}")),
    }
}

/// Exactly the prompt format the adapter was trained on (TranslateGemma chat template).
fn build_prompt(src: &str, tgt: &str, text: &str) -> Result<String, String> {
    let (sn, tn) = (lang_name(src)?, lang_name(tgt)?);
    Ok(format!(
        "<start_of_turn>user\n\
You are a professional {sn} ({src}) to {tn} ({tgt}) translator. Your goal is to accurately convey the meaning and nuances of the original {sn} text while adhering to {tn} grammar, vocabulary, and cultural sensitivities.\n\
Produce only the {tn} translation, without any additional explanations or commentary. Please translate the following {sn} text into {tn}:\n\n\n\
{text}<end_of_turn>\n<start_of_turn>model\n"
    ))
}

fn free_port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .map_err(|e| e.to_string())
}

fn server_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("llama");
    let exe = dir.join(if cfg!(windows) { "llama-server.exe" } else { "llama-server" });
    if !exe.exists() {
        return Err(format!("llama-server topilmadi: {}", exe.display()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755));
    }
    Ok(exe)
}

fn log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("engine.log"))
}

fn log_tail(path: &PathBuf) -> String {
    let Ok(mut f) = File::open(path) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(1500)));
    let mut s = String::new();
    let _ = f.read_to_string(&mut s);
    s
}

fn stop_inner(state: &EngineState) {
    if let Some(mut e) = state.0.lock().unwrap().take() {
        let _ = e.child.kill();
        let _ = e.child.wait();
    }
}

/// Starts llama-server with the chosen model and waits until it reports healthy.
#[tauri::command]
async fn start_engine(
    app: AppHandle,
    state: State<'_, EngineState>,
    model_path: String,
    use_gpu: bool,
) -> Result<(), String> {
    stop_inner(&state);

    if !PathBuf::from(&model_path).is_file() {
        return Err(format!("Model fayli topilmadi: {model_path}"));
    }
    let exe = server_path(&app)?;
    let port = free_port()?;
    let log = log_path(&app)?;
    let log_file = File::create(&log).map_err(|e| e.to_string())?;

    let port_s = port.to_string();
    let mut cmd = Command::new(&exe);
    cmd.args([
        "-m", model_path.as_str(),
        "--host", "127.0.0.1",
        "--port", port_s.as_str(),
        "-c", "4096",
        "-ngl", if use_gpu { "99" } else { "0" },
    ])
    .current_dir(exe.parent().unwrap())
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::from(log_file));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().map_err(|e| format!("llama-server ishga tushmadi: {e}"))?;
    *state.0.lock().unwrap() = Some(Engine { child, port });

    // Loading a 4 GB model can take a while on slow disks.
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/health");
    for _ in 0..600 {
        {
            let mut guard = state.0.lock().unwrap();
            match guard.as_mut() {
                Some(e) => {
                    if let Ok(Some(status)) = e.child.try_wait() {
                        *guard = None;
                        return Err(format!(
                            "Model yuklanmadi (kod {status}).\n\n{}",
                            log_tail(&log)
                        ));
                    }
                }
                None => return Err("To'xtatildi".into()),
            }
        }
        if let Ok(r) = client.get(&url).timeout(Duration::from_secs(2)).send().await {
            if r.status().is_success() {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    stop_inner(&state);
    Err(format!("Model 5 daqiqada yuklanmadi.\n\n{}", log_tail(&log)))
}

#[tauri::command]
fn stop_engine(state: State<'_, EngineState>) {
    stop_inner(&state);
}

#[derive(Deserialize)]
struct CompletionResp {
    content: String,
}

/// Translates one chunk of text (a sentence or short paragraph).
#[tauri::command]
async fn translate(
    state: State<'_, EngineState>,
    text: String,
    src: String,
    tgt: String,
) -> Result<String, String> {
    let port = state
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|e| e.port)
        .ok_or("Model yuklanmagan")?;

    let body = json!({
        "prompt": build_prompt(&src, &tgt, text.trim())?,
        "n_predict": 512,
        "temperature": 0.0,
        "repeat_penalty": 1.1,
        "stop": ["<end_of_turn>", "<start_of_turn>"],
        "cache_prompt": true
    });

    let resp = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/completion"))
        .json(&body)
        .timeout(Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| format!("Tarjima xatosi: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Tarjima xatosi: HTTP {}", resp.status()));
    }
    let out: CompletionResp = resp.json().await.map_err(|e| e.to_string())?;
    Ok(out.content.trim().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState::default())
        .invoke_handler(tauri::generate_handler![start_engine, stop_engine, translate])
        .build(tauri::generate_context!())
        .expect("error while building MA Tarjimon");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_inner(&handle.state::<EngineState>());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_matches_training_format() {
        let p = build_prompt("en", "uz", "Hello").unwrap();
        assert!(p.starts_with("<start_of_turn>user\nYou are a professional English (en) to Uzbek (uz) translator."));
        assert!(p.contains("Please translate the following English text into Uzbek:\n\n\nHello<end_of_turn>\n<start_of_turn>model\n"));
        assert!(build_prompt("uz", "en", "Salom").unwrap().contains("Uzbek (uz) to English (en)"));
        assert!(build_prompt("ru", "uz", "x").is_err());
    }
}
