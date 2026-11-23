//! 「チャンネルで初めて(初見)」の判定用に、これまでにコメントを見た人の ID を記録する。
//! YouTube のコメントには「初めての発言」の情報がないため、CommentDeck 側で覚えておく。
//! 接続先(チャンネル)ごとに 1 ファイル、1 行 1 ID。

use std::collections::HashSet;
use std::io::Write;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

pub struct Seen {
    set: HashSet<String>,
    path: Option<PathBuf>,
}

/// ファイル名に使えるように(英数字と - _ 以外は _ に)。
pub fn file_key(key: &str) -> String {
    let k: String = key
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    k.chars().take(80).collect()
}

pub fn dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("seen"))
}

impl Seen {
    pub fn load(app: &AppHandle, platform: &str, key: &str) -> Seen {
        let path = dir(app).map(|d| d.join(format!("{platform}-{}.txt", file_key(key))));
        Seen::from_path(path)
    }

    pub fn from_path(path: Option<PathBuf>) -> Seen {
        let set = path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .map(|s| {
                s.lines()
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        Seen { set, path }
    }

    /// 記録する。初めて見た ID なら true。
    pub fn mark(&mut self, id: &str) -> bool {
        if id.is_empty() || !self.set.insert(id.to_string()) {
            return false;
        }
        if let Some(p) = &self.path {
            if let Some(d) = p.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(p)
            {
                let _ = writeln!(f, "{id}");
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_and_persists() {
        let dir = std::env::temp_dir().join(format!("cd-seen-test-{}", std::process::id()));
        let path = dir.join("youtube-test.txt");
        let _ = std::fs::remove_dir_all(&dir);
        let mut s = Seen::from_path(Some(path.clone()));
        assert!(s.mark("UC1"));
        assert!(!s.mark("UC1"));
        assert!(s.mark("UC2"));
        assert!(!s.mark(""));
        // 読み込み直しても覚えている
        let mut s2 = Seen::from_path(Some(path));
        assert!(!s2.mark("UC1"));
        assert!(s2.mark("UC3"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn keys() {
        assert_eq!(file_key("@Linn__T_Games"), "_linn__t_games");
        assert_eq!(
            file_key("https://www.youtube.com/@x"),
            "https___www_youtube_com__x"
        );
    }
}
