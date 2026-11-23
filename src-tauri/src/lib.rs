mod model;
mod seen;
mod server;
mod twitch;
mod youtube;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::broadcast;

pub use model::{ChatMessage, Paid, Part};

pub const DEFAULT_PORT: u16 = 17890;
const CONFIG_FILE: &str = "config.json";

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    /// "idle" / "connecting" / "connected" / "error"
    pub state: String,
    pub detail: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub youtube: SourceStatus,
    pub twitch: SourceStatus,
    pub overlay_clients: usize,
}

pub struct AppState {
    /// オーバーレイ(OBS のブラウザソース)へ送る JSON
    pub tx: broadcast::Sender<String>,
    pub config: RwLock<Value>,
    pub port: u16,
    pub status: Mutex<Status>,
    youtube_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    twitch_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl AppState {
    pub fn config_message(&self) -> String {
        json!({ "type": "config", "config": *self.config.read().unwrap() }).to_string()
    }
}

/// コメントをオーバーレイと設定画面のプレビューに送る。
pub fn publish(app: &AppHandle, msg: &ChatMessage) {
    let state = app.state::<Arc<AppState>>();
    let _ = state
        .tx
        .send(json!({ "type": "message", "message": msg }).to_string());
    let _ = app.emit("chat", msg);
}

/// 削除されたコメントを消す(YouTube のモデレーター削除・Twitch のメッセージ削除)。
pub fn publish_delete(app: &AppHandle, id: &str) {
    let state = app.state::<Arc<AppState>>();
    let _ = state
        .tx
        .send(json!({ "type": "delete", "id": id }).to_string());
    let _ = app.emit("chat-delete", id);
}

pub fn set_status(app: &AppHandle, platform: &str, state_name: &str, detail: impl Into<String>) {
    let state = app.state::<Arc<AppState>>();
    let snapshot = {
        let mut st = state.status.lock().unwrap();
        let s = SourceStatus {
            state: state_name.to_string(),
            detail: detail.into(),
        };
        if platform == "youtube" {
            st.youtube = s;
        } else {
            st.twitch = s;
        }
        st.clone()
    };
    let _ = app.emit("status", snapshot);
}

pub fn emit_status(app: &AppHandle) {
    let state = app.state::<Arc<AppState>>();
    let snapshot = state.status.lock().unwrap().clone();
    let _ = app.emit("status", snapshot);
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join(CONFIG_FILE))
}

fn load_config(app: &AppHandle) -> Value {
    config_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        // メモ帳などで編集すると先頭に BOM が付くことがあるので取り除く
        .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok())
        .unwrap_or(Value::Null)
}

// ------------------------------------------------------------ コマンド

#[tauri::command]
fn get_initial(app: AppHandle, state: State<'_, Arc<AppState>>) -> Value {
    json!({
        "config": *state.config.read().unwrap(),
        "overlayUrl": format!("http://127.0.0.1:{}/overlay", state.port),
        "status": *state.status.lock().unwrap(),
        "version": app.package_info().version.to_string(),
    })
}

#[tauri::command]
fn save_config(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    config: Value,
) -> Result<(), String> {
    let path = config_path(&app).ok_or("設定の保存先が見つかりません")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("設定を保存できませんでした: {e}"))?;
    *state.config.write().unwrap() = config;
    let _ = state.tx.send(state.config_message());
    Ok(())
}

/// 保存はせずに、オーバーレイの見た目だけ更新する(編集中のリアルタイム反映)。
#[tauri::command]
fn preview_config(state: State<'_, Arc<AppState>>, config: Value) {
    *state.config.write().unwrap() = config;
    let _ = state.tx.send(state.config_message());
}

#[tauri::command]
fn connect_youtube(app: AppHandle, state: State<'_, Arc<AppState>>, input: String) {
    if let Some(h) = state.youtube_task.lock().unwrap().take() {
        h.abort();
    }
    let handle = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        youtube::run(handle, input).await;
    });
    *state.youtube_task.lock().unwrap() = Some(task);
}

#[tauri::command]
fn disconnect_youtube(app: AppHandle, state: State<'_, Arc<AppState>>) {
    if let Some(h) = state.youtube_task.lock().unwrap().take() {
        h.abort();
    }
    set_status(&app, "youtube", "idle", "");
}

#[tauri::command]
fn connect_twitch(app: AppHandle, state: State<'_, Arc<AppState>>, channel: String) {
    if let Some(h) = state.twitch_task.lock().unwrap().take() {
        h.abort();
    }
    let handle = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        twitch::run(handle, channel).await;
    });
    *state.twitch_task.lock().unwrap() = Some(task);
}

#[tauri::command]
fn disconnect_twitch(app: AppHandle, state: State<'_, Arc<AppState>>) {
    if let Some(h) = state.twitch_task.lock().unwrap().take() {
        h.abort();
    }
    set_status(&app, "twitch", "idle", "");
}

/// OBS に表示中のコメントを全部消す(設定画面の「クリア」)。
#[tauri::command]
fn clear_overlay(state: State<'_, Arc<AppState>>) {
    let _ = state.tx.send(json!({ "type": "clear" }).to_string());
}

/// 「初見」判定の記録を消す(次からは全員が初見扱いからやり直し)。
#[tauri::command]
fn reset_seen(app: AppHandle) -> Result<(), String> {
    if let Some(d) = seen::dir(&app) {
        if d.exists() {
            std::fs::remove_dir_all(&d).map_err(|e| format!("記録を消せませんでした: {e}"))?;
        }
    }
    Ok(())
}

/// テストコメントをオーバーレイにも流す(設定画面で作った ChatMessage と同じ形の JSON)。
#[tauri::command]
fn send_test(state: State<'_, Arc<AppState>>, message: Value) {
    let _ = state
        .tx
        .send(json!({ "type": "message", "message": message }).to_string());
}

#[tauri::command]
async fn list_fonts() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut families = font_kit::source::SystemSource::new()
            .all_families()
            .unwrap_or_default();
        families.sort();
        families.dedup();
        families
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("保存できませんでした: {e}"))
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("読み込めませんでした: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckResult {
    available: bool,
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(|e| format!("アップデートを確認できませんでした: {e}"))?
        .check()
        .await
        .map_err(|e| format!("アップデートを確認できませんでした: {e}"))?;
    Ok(match update {
        Some(u) => UpdateCheckResult {
            available: true,
            current_version,
            version: Some(u.version.clone()),
            notes: u.body.clone(),
        },
        None => UpdateCheckResult {
            available: false,
            current_version,
            version: None,
            notes: None,
        },
    })
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<bool, String> {
    let update = app
        .updater()
        .map_err(|e| format!("アップデートできませんでした: {e}"))?
        .check()
        .await
        .map_err(|e| format!("アップデートできませんでした: {e}"))?;
    let Some(update) = update else {
        return Ok(false);
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("アップデートできませんでした: {e}"))?;
    app.restart();
}

pub fn run() {
    let (tx, _) = broadcast::channel::<String>(512);
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let config = load_config(app.handle());
            let port = config
                .get("port")
                .and_then(|p| p.as_u64())
                .filter(|p| (1024..=65535).contains(p))
                .map(|p| p as u16)
                .unwrap_or(DEFAULT_PORT);
            let state = Arc::new(AppState {
                tx: tx.clone(),
                config: RwLock::new(config),
                port,
                status: Mutex::new(Status::default()),
                youtube_task: Mutex::new(None),
                twitch_task: Mutex::new(None),
            });
            app.manage(state.clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::run(handle.clone(), state, port).await {
                    let _ = handle.emit("server-error", e);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_initial,
            save_config,
            preview_config,
            connect_youtube,
            disconnect_youtube,
            connect_twitch,
            disconnect_twitch,
            send_test,
            clear_overlay,
            reset_seen,
            list_fonts,
            write_text_file,
            read_text_file,
            check_update,
            install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CommentDeck");
}
