//! Twitch のチャット(公式 IRC over WebSocket)。ログイン不要の読み取り専用接続。

use std::collections::HashMap;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tauri::AppHandle;
use tokio_tungstenite::tungstenite::Message;

use crate::model::{now_ms, ChatMessage, Paid, Part};
use crate::{publish, publish_delete, set_status};

const IRC_URL: &str = "wss://irc-ws.chat.twitch.tv:443";

/// チャンネル名を取り出す(URL でも名前でも可)。
pub fn normalize_channel(input: &str) -> String {
    let s = input.trim().trim_start_matches('#').trim_start_matches('@');
    let s = s
        .rsplit("twitch.tv/")
        .next()
        .unwrap_or(s)
        .split(['/', '?'])
        .next()
        .unwrap_or("");
    s.to_lowercase()
}

pub async fn run(app: AppHandle, input: String) {
    let channel = normalize_channel(&input);
    if channel.is_empty() {
        set_status(
            &app,
            "twitch",
            "error",
            "Twitch のチャンネル名を入力してください",
        );
        return;
    }
    let mut wait = 2u64;
    loop {
        set_status(
            &app,
            "twitch",
            "connecting",
            format!("#{channel} に接続しています…"),
        );
        match session(&app, &channel).await {
            Ok(()) => wait = 2,
            Err(e) => set_status(
                &app,
                "twitch",
                "error",
                format!("{e}({wait} 秒後に再接続します)"),
            ),
        }
        tokio::time::sleep(Duration::from_secs(wait)).await;
        wait = (wait * 2).min(60);
    }
}

async fn session(app: &AppHandle, channel: &str) -> Result<(), String> {
    let (mut ws, _) = tokio_tungstenite::connect_async(IRC_URL)
        .await
        .map_err(|e| format!("Twitch に接続できませんでした: {e}"))?;
    let nick = format!("justinfan{}", 10000 + now_ms() % 80000);
    for line in [
        "CAP REQ :twitch.tv/tags twitch.tv/commands".to_string(),
        "PASS SCHMOOPIIE".to_string(),
        format!("NICK {nick}"),
        format!("JOIN #{channel}"),
    ] {
        ws.send(Message::Text(line.into()))
            .await
            .map_err(|e| e.to_string())?;
    }

    while let Some(frame) = ws.next().await {
        let frame = frame.map_err(|e| format!("Twitch との接続が切れました: {e}"))?;
        let text = match frame {
            Message::Text(t) => t.to_string(),
            Message::Close(_) => return Err("Twitch との接続が切れました".into()),
            _ => continue,
        };
        for line in text.split("\r\n").filter(|l| !l.is_empty()) {
            if line.starts_with("PING") {
                ws.send(Message::Text(line.replacen("PING", "PONG", 1).into()))
                    .await
                    .map_err(|e| e.to_string())?;
                continue;
            }
            let irc = parse_line(line);
            match irc.command.as_str() {
                "ROOMSTATE" => set_status(
                    app,
                    "twitch",
                    "connected",
                    format!("#{channel} のチャットを表示しています"),
                ),
                "PRIVMSG" => publish(app, &privmsg(&irc)),
                "USERNOTICE" => {
                    if let Some(m) = usernotice(&irc) {
                        publish(app, &m);
                    }
                }
                "CLEARMSG" => {
                    if let Some(id) = irc.tags.get("target-msg-id") {
                        publish_delete(app, id);
                    }
                }
                "NOTICE" => {
                    let msg = irc.trailing.clone();
                    if msg.to_lowercase().contains("login")
                        || msg.to_lowercase().contains("suspended")
                    {
                        set_status(app, "twitch", "error", msg);
                    }
                }
                "RECONNECT" => return Ok(()),
                _ => {}
            }
        }
    }
    Err("Twitch との接続が切れました".into())
}

struct Irc {
    tags: HashMap<String, String>,
    command: String,
    trailing: String,
}

fn unescape_tag(v: &str) -> String {
    let mut out = String::new();
    let mut chars = v.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('s') => out.push(' '),
                Some(':') => out.push(';'),
                Some('\\') => out.push('\\'),
                Some('r') => out.push('\r'),
                Some('n') => out.push('\n'),
                Some(o) => out.push(o),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn parse_line(line: &str) -> Irc {
    let mut rest = line;
    let mut tags = HashMap::new();
    if let Some(r) = rest.strip_prefix('@') {
        let (t, r2) = r.split_once(' ').unwrap_or((r, ""));
        for kv in t.split(';') {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            tags.insert(k.to_string(), unescape_tag(v));
        }
        rest = r2;
    }
    if rest.starts_with(':') {
        rest = rest.split_once(' ').map(|(_, r)| r).unwrap_or("");
    }
    let (head, trailing) = match rest.split_once(" :") {
        Some((h, t)) => (h, t.to_string()),
        None => (rest, String::new()),
    };
    let command = head.split(' ').next().unwrap_or("").to_string();
    Irc {
        tags,
        command,
        trailing,
    }
}

fn roles(tags: &HashMap<String, String>) -> Vec<String> {
    let badges = tags.get("badges").cloned().unwrap_or_default();
    let mut r = Vec::new();
    for b in badges.split(',') {
        match b.split('/').next().unwrap_or("") {
            "broadcaster" => r.push("owner".to_string()),
            "moderator" => r.push("moderator".to_string()),
            "subscriber" | "founder" => r.push("member".to_string()),
            "vip" => r.push("vip".to_string()),
            "partner" => r.push("verified".to_string()),
            _ => {}
        }
    }
    if tags.get("first-msg").map(|v| v == "1").unwrap_or(false) {
        r.push("first".to_string());
    }
    r.dedup();
    r
}

/// エモート(emotes タグの位置は Unicode の文字単位)を画像にする。
fn parts_with_emotes(text: &str, emotes: &str) -> Vec<Part> {
    let chars: Vec<char> = text.chars().collect();
    let mut ranges: Vec<(usize, usize, String)> = Vec::new();
    for e in emotes.split('/').filter(|s| !s.is_empty()) {
        if let Some((id, pos)) = e.split_once(':') {
            for p in pos.split(',') {
                if let Some((a, b)) = p.split_once('-') {
                    if let (Ok(a), Ok(b)) = (a.parse::<usize>(), b.parse::<usize>()) {
                        if a <= b && b < chars.len() {
                            ranges.push((a, b, id.to_string()));
                        }
                    }
                }
            }
        }
    }
    ranges.sort_by_key(|r| r.0);
    let mut parts = Vec::new();
    let mut i = 0;
    for (a, b, id) in ranges {
        if a < i {
            continue;
        }
        if a > i {
            parts.push(Part::Text {
                text: chars[i..a].iter().collect(),
            });
        }
        parts.push(Part::Emoji {
            url: format!("https://static-cdn.jtvnw.net/emoticons/v2/{id}/default/dark/2.0"),
            alt: chars[a..=b].iter().collect(),
        });
        i = b + 1;
    }
    if i < chars.len() {
        parts.push(Part::Text {
            text: chars[i..].iter().collect(),
        });
    }
    parts
}

fn base(irc: &Irc, text: String) -> ChatMessage {
    let t = &irc.tags;
    let name = t
        .get("display-name")
        .filter(|s| !s.is_empty())
        .or_else(|| t.get("login"))
        .cloned()
        .unwrap_or_default();
    ChatMessage {
        id: t
            .get("id")
            .cloned()
            .unwrap_or_else(|| format!("tw-{}", now_ms())),
        platform: "twitch".into(),
        author_id: t.get("user-id").cloned().unwrap_or_default(),
        author_name: name,
        author_icon: String::new(),
        author_color: t.get("color").cloned().unwrap_or_default(),
        roles: roles(t),
        parts: parts_with_emotes(&text, t.get("emotes").map(|s| s.as_str()).unwrap_or("")),
        text,
        paid: None,
        timestamp: now_ms(),
    }
}

fn strip_action(text: &str) -> String {
    text.strip_prefix("\u{1}ACTION ")
        .and_then(|s| s.strip_suffix('\u{1}'))
        .unwrap_or(text)
        .to_string()
}

fn privmsg(irc: &Irc) -> ChatMessage {
    let mut m = base(irc, strip_action(&irc.trailing));
    if let Some(bits) = irc.tags.get("bits").and_then(|b| b.parse::<f64>().ok()) {
        m.paid = Some(Paid {
            kind: "bits".into(),
            amount_text: format!("{bits} bits"),
            amount: bits,
            color: String::new(),
        });
    }
    m
}

/// サブスク・ギフトなどの通知。
fn usernotice(irc: &Irc) -> Option<ChatMessage> {
    let kind = match irc.tags.get("msg-id").map(|s| s.as_str()).unwrap_or("") {
        "sub" | "resub" | "primepaidupgrade" | "giftpaidupgrade" => "membership",
        "subgift" | "submysterygift" | "anonsubgift" => "gift",
        _ => return None,
    };
    let system = irc.tags.get("system-msg").cloned().unwrap_or_default();
    let text = if irc.trailing.is_empty() {
        system.clone()
    } else {
        irc.trailing.clone()
    };
    let mut m = base(irc, text);
    if !irc.trailing.is_empty() && !system.is_empty() {
        m.parts.insert(
            0,
            Part::Text {
                text: format!("{system} "),
            },
        );
    }
    let count = irc
        .tags
        .get("msg-param-mass-gift-count")
        .or_else(|| irc.tags.get("msg-param-cumulative-months"))
        .and_then(|c| c.parse::<f64>().ok())
        .unwrap_or(1.0);
    m.paid = Some(Paid {
        kind: kind.into(),
        amount_text: system,
        amount: count,
        color: String::new(),
    });
    Some(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_names() {
        assert_eq!(
            normalize_channel("https://www.twitch.tv/Some_User?x=1"),
            "some_user"
        );
        assert_eq!(normalize_channel("#Foo"), "foo");
        assert_eq!(normalize_channel("@bar"), "bar");
    }

    #[test]
    fn privmsg_with_tags_and_emotes() {
        let line = "@badges=moderator/1,subscriber/12;bits=100;color=#FF0000;display-name=テスト;emotes=25:6-10;first-msg=1;id=abc :u!u@u.tmi.twitch.tv PRIVMSG #ch :hello Kappa!";
        let irc = parse_line(line);
        assert_eq!(irc.command, "PRIVMSG");
        let m = privmsg(&irc);
        assert_eq!(m.author_name, "テスト");
        assert_eq!(m.id, "abc");
        assert!(m.roles.contains(&"moderator".to_string()));
        assert!(m.roles.contains(&"member".to_string()));
        assert!(m.roles.contains(&"first".to_string()));
        assert_eq!(m.paid.as_ref().unwrap().amount, 100.0);
        assert_eq!(m.parts.len(), 3); // "hello " + Kappa + "!"
        match &m.parts[1] {
            Part::Emoji { alt, .. } => assert_eq!(alt, "Kappa"),
            _ => panic!("emote expected"),
        }
    }

    #[test]
    fn escaped_tags() {
        assert_eq!(unescape_tag(r"a\sb\:c\\d"), r"a b;c\d");
    }
}
