//! OBS のブラウザソースが読み込むページを配る小さな Web サーバー(127.0.0.1 のみ)。
//! /overlay で表示ページ、/ws でコメントと見た目の設定をリアルタイムに送る。

use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::header;
use axum::response::{Html, IntoResponse, Redirect};
use axum::routing::get;
use axum::Router;
use tauri::AppHandle;

use crate::{emit_status, AppState};

// 設定画面のプレビューと同じファイルを使う(見た目が必ず一致するように)
const OVERLAY_HTML: &str = include_str!("../../ui/overlay.html");
const OVERLAY_JS: &str = include_str!("../../ui/overlay.js");
const RENDER_JS: &str = include_str!("../../ui/shared/render.js");

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
    state: Arc<AppState>,
}

fn js(body: &'static str) -> impl IntoResponse {
    (
        [
            (
                header::CONTENT_TYPE,
                "application/javascript; charset=utf-8",
            ),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        body,
    )
}

pub async fn run(app: AppHandle, state: Arc<AppState>, port: u16) -> Result<(), String> {
    let ctx = Ctx { app, state };
    let router = Router::new()
        .route("/", get(|| async { Redirect::temporary("/overlay") }))
        .route("/overlay", get(|| async { Html(OVERLAY_HTML) }))
        .route("/overlay.js", get(|| async { js(OVERLAY_JS) }))
        .route("/shared/render.js", get(|| async { js(RENDER_JS) }))
        .route("/ws", get(ws_handler))
        .with_state(ctx);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| {
            format!("ポート {port} を使えませんでした(他のアプリが使っている可能性があります): {e}")
        })?;
    axum::serve(listener, router)
        .await
        .map_err(|e| e.to_string())
}

async fn ws_handler(ws: WebSocketUpgrade, State(ctx): State<Ctx>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| client(socket, ctx))
}

async fn client(mut socket: WebSocket, ctx: Ctx) {
    let mut rx = ctx.state.tx.subscribe();
    change_clients(&ctx, 1);
    // つないだ直後に今の見た目を送る
    if socket
        .send(Message::Text(ctx.state.config_message().into()))
        .await
        .is_ok()
    {
        loop {
            tokio::select! {
                msg = rx.recv() => match msg {
                    Ok(text) => {
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                },
                incoming = socket.recv() => match incoming {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                },
            }
        }
    }
    change_clients(&ctx, -1);
}

fn change_clients(ctx: &Ctx, delta: isize) {
    {
        let mut st = ctx.state.status.lock().unwrap();
        st.overlay_clients = (st.overlay_clients as isize + delta).max(0) as usize;
    }
    emit_status(&ctx.app);
}
