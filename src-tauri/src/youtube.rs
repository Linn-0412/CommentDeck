//! YouTube のライブチャット。
//! 公式 API は 1 日の利用上限が厳しいため、多くのコメントビューアと同じく、
//! YouTube のチャット画面が使っている仕組み(live_chat ページ + get_live_chat)から読む。
//! YouTube の仕様変更で動かなくなる可能性がある。

use std::time::Duration;

use regex::Regex;
use reqwest::Client;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::model::{now_ms, parse_amount, ChatMessage, Paid, Part};
use crate::{publish, publish_delete, set_status};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

fn client() -> Client {
    Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(20))
        .build()
        .unwrap_or_default()
}

/// 入力が動画(配信)を直接指しているならその ID。
pub fn video_id_from_input(input: &str) -> Option<String> {
    let s = input.trim();
    let re_id = Regex::new(r"^[\w-]{11}$").unwrap();
    if re_id.is_match(s) && !s.starts_with('@') {
        return Some(s.to_string());
    }
    let re = Regex::new(r"(?:v=|youtu\.be/|/live/|/shorts/)([\w-]{11})").unwrap();
    re.captures(s).map(|c| c[1].to_string())
}

/// 入力をチャンネルの URL にする(@ハンドル / URL / チャンネル ID)。
pub fn channel_url(input: &str) -> Option<String> {
    let s = input.trim();
    if s.is_empty() {
        return None;
    }
    if s.starts_with("http") {
        let re =
            Regex::new(r"youtube\.com/(@[^/?#]+|channel/[\w-]+|c/[^/?#]+|user/[^/?#]+)").unwrap();
        return re
            .captures(s)
            .map(|c| format!("https://www.youtube.com/{}", &c[1]));
    }
    if s.starts_with('@') {
        return Some(format!("https://www.youtube.com/{s}"));
    }
    if Regex::new(r"^UC[\w-]{22}$").unwrap().is_match(s) {
        return Some(format!("https://www.youtube.com/channel/{s}"));
    }
    Some(format!("https://www.youtube.com/@{s}"))
}

/// チャンネルの /live から、配信中(または予約中)の動画 ID を探す。
async fn find_live_video(http: &Client, channel: &str) -> Result<Option<String>, String> {
    let html = http
        .get(format!("{channel}/live"))
        .header("Accept-Language", "ja,en;q=0.8")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let re = Regex::new(
        r#"<link rel="canonical" href="https://www\.youtube\.com/watch\?v=([\w-]{11})""#,
    )
    .unwrap();
    Ok(re.captures(&html).map(|c| c[1].to_string()))
}

pub async fn run(app: AppHandle, input: String) {
    let http = client();
    let direct = video_id_from_input(&input);
    let channel = if direct.is_none() {
        channel_url(&input)
    } else {
        None
    };
    if direct.is_none() && channel.is_none() {
        set_status(
            &app,
            "youtube",
            "error",
            "YouTube のチャンネル(@ハンドル)か配信の URL を入力してください",
        );
        return;
    }
    loop {
        set_status(&app, "youtube", "connecting", "配信を探しています…");
        let video = match &direct {
            Some(v) => Some(v.clone()),
            None => find_live_video(&http, channel.as_deref().unwrap())
                .await
                .unwrap_or(None),
        };
        match video {
            Some(v) => match chat_session(&app, &http, &v).await {
                Ok(()) => set_status(
                    &app,
                    "youtube",
                    "connecting",
                    "配信が終了しました。次の配信を待っています…",
                ),
                Err(e) => set_status(
                    &app,
                    "youtube",
                    "connecting",
                    format!("{e}(30 秒後にもう一度試します)"),
                ),
            },
            None => set_status(
                &app,
                "youtube",
                "connecting",
                "配信中・予約中の枠が見つかりません。配信が始まるのを待っています…",
            ),
        }
        if direct.is_some() {
            // 動画を直接指定したときは、その動画のチャットが始まるまで待つ
        }
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

/// ページに埋め込まれた ytInitialData を取り出す。
fn initial_data(html: &str) -> Option<Value> {
    let pos = html.find("ytInitialData")?;
    let start = pos + html[pos..].find('{')?;
    serde_json::Deserializer::from_str(&html[start..])
        .into_iter::<Value>()
        .next()?
        .ok()
}

fn capture(html: &str, pattern: &str) -> Option<String> {
    Regex::new(pattern)
        .ok()?
        .captures(html)
        .map(|c| c[1].to_string())
}

/// 続きを取るための continuation と待ち時間(ms)。
fn next_continuation(conts: &Value) -> Option<(String, u64)> {
    for c in conts.as_array()? {
        for key in [
            "invalidationContinuationData",
            "timedContinuationData",
            "reloadContinuationData",
        ] {
            if let Some(d) = c.get(key) {
                if let Some(cont) = d.get("continuation").and_then(|v| v.as_str()) {
                    let wait = d.get("timeoutMs").and_then(|v| v.as_u64()).unwrap_or(1500);
                    return Some((cont.to_string(), wait));
                }
            }
        }
    }
    None
}

async fn chat_session(app: &AppHandle, http: &Client, video: &str) -> Result<(), String> {
    let html = http
        .get(format!(
            "https://www.youtube.com/live_chat?is_popout=1&v={video}"
        ))
        .header("Accept-Language", "ja,en;q=0.8")
        .send()
        .await
        .map_err(|e| format!("YouTube に接続できませんでした: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let key = capture(&html, r#""INNERTUBE_API_KEY":"([^"]+)""#);
    let version = capture(&html, r#""INNERTUBE_CLIENT_VERSION":"([^"]+)""#)
        .or_else(|| capture(&html, r#""clientVersion":"([^"]+)""#))
        .unwrap_or_else(|| "2.20250101.00.00".into());
    let data = initial_data(&html)
        .ok_or("チャットが見つかりません(まだ配信が始まっていない可能性があります)")?;
    let renderer = data.pointer("/contents/liveChatRenderer").ok_or(
        "この配信のチャットを読み込めませんでした(チャットが無効か、配信が始まっていません)",
    )?;

    // 「上位のチャット」ではなく「すべてのチャット」に切り替える
    let all_chat = renderer
        .pointer("/header/liveChatHeaderRenderer/viewSelector/sortFilterSubMenuRenderer/subMenuItems/1/continuation/reloadContinuationData/continuation")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let (mut cont, _) = match all_chat {
        Some(c) => (c, 0),
        None => next_continuation(&renderer["continuations"])
            .ok_or("チャットの続きを取得できませんでした")?,
    };

    set_status(
        app,
        "youtube",
        "connected",
        format!("配信のチャットを表示しています(https://youtu.be/{video})"),
    );
    let mut url =
        "https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false".to_string();
    if let Some(k) = key {
        url.push_str(&format!("&key={k}"));
    }
    let mut first = true; // 最初の取得は過去のコメントなので表示しない
    let mut errors = 0;
    loop {
        let body = json!({
            "context": { "client": { "clientName": "WEB", "clientVersion": version, "hl": "ja", "gl": "JP" } },
            "continuation": cont,
        });
        let res = http.post(&url).json(&body).send().await;
        let value: Value = match res {
            Ok(r) if r.status().is_success() => r.json().await.unwrap_or(Value::Null),
            Ok(r) => {
                errors += 1;
                if errors > 5 {
                    return Err(format!(
                        "YouTube からの応答がエラーになりました({})",
                        r.status()
                    ));
                }
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
            Err(e) => {
                errors += 1;
                if errors > 5 {
                    return Err(format!("YouTube との通信に失敗しました: {e}"));
                }
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
        };
        errors = 0;
        let lcc = &value["continuationContents"]["liveChatContinuation"];
        if !first {
            if let Some(actions) = lcc["actions"].as_array() {
                for a in actions {
                    handle_action(app, a);
                }
            }
        }
        first = false;
        match next_continuation(&lcc["continuations"]) {
            Some((c, wait)) => {
                cont = c;
                tokio::time::sleep(Duration::from_millis(wait.clamp(500, 5000))).await;
            }
            None => return Ok(()), // 続きがない = 配信終了
        }
    }
}

fn text_of(v: &Value) -> String {
    if let Some(s) = v.get("simpleText").and_then(|s| s.as_str()) {
        return s.to_string();
    }
    v.get("runs")
        .and_then(|r| r.as_array())
        .map(|runs| {
            runs.iter()
                .map(|r| {
                    r.get("text")
                        .and_then(|t| t.as_str())
                        .map(|t| t.to_string())
                        .or_else(|| {
                            r.pointer("/emoji/shortcuts/0")
                                .and_then(|s| s.as_str())
                                .map(|s| s.to_string())
                        })
                        .unwrap_or_default()
                })
                .collect::<String>()
        })
        .unwrap_or_default()
}

fn last_thumb(v: &Value) -> String {
    v.get("thumbnails")
        .and_then(|t| t.as_array())
        .and_then(|t| t.last())
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .map(|u| {
            if u.starts_with("//") {
                format!("https:{u}")
            } else {
                u.to_string()
            }
        })
        .unwrap_or_default()
}

fn runs_to_parts(message: &Value) -> Vec<Part> {
    let mut parts = Vec::new();
    if let Some(runs) = message.get("runs").and_then(|r| r.as_array()) {
        for r in runs {
            if let Some(t) = r.get("text").and_then(|t| t.as_str()) {
                parts.push(Part::Text {
                    text: t.to_string(),
                });
            } else if let Some(e) = r.get("emoji") {
                let custom = e
                    .get("isCustomEmoji")
                    .and_then(|b| b.as_bool())
                    .unwrap_or(false);
                let alt = e
                    .pointer("/shortcuts/0")
                    .and_then(|s| s.as_str())
                    .or_else(|| e.get("emojiId").and_then(|s| s.as_str()))
                    .unwrap_or("")
                    .to_string();
                if custom {
                    parts.push(Part::Emoji {
                        url: last_thumb(&e["image"]),
                        alt,
                    });
                } else {
                    // 普通の絵文字は文字のまま(フォントで表示)
                    let ch = e
                        .get("emojiId")
                        .and_then(|s| s.as_str())
                        .unwrap_or(&alt)
                        .to_string();
                    parts.push(Part::Text { text: ch });
                }
            }
        }
    } else if let Some(s) = message.get("simpleText").and_then(|s| s.as_str()) {
        parts.push(Part::Text {
            text: s.to_string(),
        });
    }
    parts
}

fn roles(badges: &Value) -> Vec<String> {
    let mut r = Vec::new();
    if let Some(list) = badges.as_array() {
        for b in list {
            let b = &b["liveChatAuthorBadgeRenderer"];
            match b.pointer("/icon/iconType").and_then(|s| s.as_str()) {
                Some("OWNER") => r.push("owner".to_string()),
                Some("MODERATOR") => r.push("moderator".to_string()),
                Some("VERIFIED") => r.push("verified".to_string()),
                _ => {}
            }
            if b.get("customThumbnail").is_some() {
                r.push("member".to_string());
            }
        }
    }
    r.dedup();
    r
}

fn argb_hex(v: &Value) -> String {
    v.as_u64()
        .map(|c| format!("#{:06x}", c & 0xFF_FFFF))
        .unwrap_or_default()
}

fn base(r: &Value) -> ChatMessage {
    let parts = runs_to_parts(&r["message"]);
    ChatMessage {
        id: r
            .get("id")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        platform: "youtube".into(),
        author_name: text_of(&r["authorName"]),
        author_icon: last_thumb(&r["authorPhoto"]),
        author_color: String::new(),
        roles: roles(&r["authorBadges"]),
        text: text_of(&r["message"]),
        parts,
        paid: None,
        timestamp: now_ms(),
    }
}

fn handle_action(app: &AppHandle, a: &Value) {
    if let Some(id) = a
        .pointer("/markChatItemAsDeletedAction/targetItemId")
        .and_then(|s| s.as_str())
    {
        publish_delete(app, id);
        return;
    }
    let Some(item) = a.pointer("/addChatItemAction/item") else {
        return;
    };
    if let Some(msg) = parse_item(item) {
        publish(app, &msg);
    }
}

pub fn parse_item(item: &Value) -> Option<ChatMessage> {
    if let Some(r) = item.get("liveChatTextMessageRenderer") {
        return Some(base(r));
    }
    if let Some(r) = item.get("liveChatPaidMessageRenderer") {
        let mut m = base(r);
        let amount_text = text_of(&r["purchaseAmountText"]);
        m.paid = Some(Paid {
            kind: "superchat".into(),
            amount: parse_amount(&amount_text),
            amount_text,
            color: argb_hex(&r["bodyBackgroundColor"]),
        });
        return Some(m);
    }
    if let Some(r) = item.get("liveChatPaidStickerRenderer") {
        let mut m = base(r);
        let amount_text = text_of(&r["purchaseAmountText"]);
        m.parts = vec![Part::Emoji {
            url: last_thumb(&r["sticker"]),
            alt: "sticker".into(),
        }];
        m.paid = Some(Paid {
            kind: "sticker".into(),
            amount: parse_amount(&amount_text),
            amount_text,
            color: argb_hex(&r["backgroundColor"]),
        });
        return Some(m);
    }
    if let Some(r) = item.get("liveChatMembershipItemRenderer") {
        let mut m = base(r);
        let header = text_of(&r["headerSubtext"]);
        if m.parts.is_empty() {
            m.parts = vec![Part::Text {
                text: header.clone(),
            }];
            m.text = header.clone();
        }
        m.roles.push("member".into());
        m.paid = Some(Paid {
            kind: "membership".into(),
            amount_text: header,
            amount: 1.0,
            color: String::new(),
        });
        return Some(m);
    }
    if let Some(r) = item.get("liveChatSponsorshipsGiftPurchaseAnnouncementRenderer") {
        let h = &r["header"]["liveChatSponsorshipsHeaderRenderer"];
        let primary = text_of(&h["primaryText"]);
        let count = Regex::new(r"(\d+)")
            .ok()
            .and_then(|re| {
                re.captures(&primary)
                    .map(|c| c[1].parse::<f64>().unwrap_or(1.0))
            })
            .unwrap_or(1.0);
        return Some(ChatMessage {
            id: r
                .get("id")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string(),
            platform: "youtube".into(),
            author_name: text_of(&h["authorName"]),
            author_icon: last_thumb(&h["authorPhoto"]),
            author_color: String::new(),
            roles: roles(&h["authorBadges"]),
            parts: vec![Part::Text {
                text: primary.clone(),
            }],
            text: primary.clone(),
            paid: Some(Paid {
                kind: "gift".into(),
                amount_text: primary,
                amount: count,
                color: String::new(),
            }),
            timestamp: now_ms(),
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inputs() {
        assert_eq!(
            video_id_from_input("https://www.youtube.com/watch?v=4t4AQ15yj1M").as_deref(),
            Some("4t4AQ15yj1M")
        );
        assert_eq!(
            video_id_from_input("https://youtu.be/4t4AQ15yj1M").as_deref(),
            Some("4t4AQ15yj1M")
        );
        assert_eq!(
            video_id_from_input("https://www.youtube.com/live/4t4AQ15yj1M?si=x").as_deref(),
            Some("4t4AQ15yj1M")
        );
        assert_eq!(video_id_from_input("@LofiGirl"), None);
        assert_eq!(
            channel_url("@LofiGirl").as_deref(),
            Some("https://www.youtube.com/@LofiGirl")
        );
        assert_eq!(
            channel_url("https://www.youtube.com/@LofiGirl/featured").as_deref(),
            Some("https://www.youtube.com/@LofiGirl")
        );
    }

    #[test]
    fn superchat_item() {
        let item = serde_json::json!({ "liveChatPaidMessageRenderer": {
            "id": "x1",
            "authorName": { "simpleText": "太郎" },
            "authorPhoto": { "thumbnails": [ { "url": "https://a/1.jpg" }, { "url": "https://a/2.jpg" } ] },
            "authorBadges": [ { "liveChatAuthorBadgeRenderer": { "customThumbnail": {}, "tooltip": "メンバー" } },
                              { "liveChatAuthorBadgeRenderer": { "icon": { "iconType": "MODERATOR" } } } ],
            "message": { "runs": [ { "text": "がんばって" },
                                   { "emoji": { "emojiId": "x", "isCustomEmoji": true, "shortcuts": [":yt:"], "image": { "thumbnails": [ { "url": "https://e/1.png" } ] } } } ] },
            "purchaseAmountText": { "simpleText": "¥1,000" },
            "bodyBackgroundColor": 4294953512u64
        }});
        let m = parse_item(&item).unwrap();
        assert_eq!(m.author_name, "太郎");
        assert_eq!(m.author_icon, "https://a/2.jpg");
        assert!(
            m.roles.contains(&"member".to_string()) && m.roles.contains(&"moderator".to_string())
        );
        let p = m.paid.unwrap();
        assert_eq!(p.kind, "superchat");
        assert_eq!(p.amount, 1000.0);
        assert_eq!(p.color, "#ffca28");
        assert_eq!(m.parts.len(), 2);
        assert_eq!(m.text, "がんばって:yt:");
    }
}
