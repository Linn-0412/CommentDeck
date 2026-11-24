//! コメントした人の記録(「初見」と「常連さん」の判定用)。
//! YouTube / Twitch のコメントには来訪回数の情報がないため、CommentDeck 側で覚えておく。
//! 接続先(チャンネル)ごとに 1 ファイル。1 行 = 「ID<TAB>配信の回数<TAB>コメント数<TAB>最後に来た配信」。
//! (古い形式の「ID だけの行」は、配信 1 回として読み込む)

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Visitor {
    /// コメントした配信の数(同じ配信で何回コメントしても 1)
    pub streams: u32,
    pub comments: u32,
    /// 最後にコメントした配信(YouTube は動画 ID、Twitch は日付)
    pub last: String,
}

pub struct Seen {
    map: HashMap<String, Visitor>,
    path: Option<PathBuf>,
    dirty: bool,
    last_flush: Instant,
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
        let mut map = HashMap::new();
        if let Some(text) = path.as_ref().and_then(|p| std::fs::read_to_string(p).ok()) {
            for line in text.lines() {
                let mut f = line.trim().split('\t');
                let Some(id) = f.next().filter(|s| !s.is_empty()) else {
                    continue;
                };
                let streams = f.next().and_then(|s| s.parse().ok()).unwrap_or(1);
                let comments = f.next().and_then(|s| s.parse().ok()).unwrap_or(1);
                let last = f.next().unwrap_or("").to_string();
                map.insert(
                    id.to_string(),
                    Visitor {
                        streams,
                        comments,
                        last,
                    },
                );
            }
        }
        Seen {
            map,
            path,
            dirty: false,
            last_flush: Instant::now(),
        }
    }

    /// コメントを記録する。戻り値は(初めて見た人か, その人がコメントした配信の数)。
    pub fn record(&mut self, id: &str, stream: &str) -> (bool, u32) {
        if id.is_empty() {
            return (false, 0);
        }
        let first = !self.map.contains_key(id);
        let v = self.map.entry(id.to_string()).or_default();
        if first || v.last != stream {
            v.streams += 1;
            v.last = stream.to_string();
        }
        v.comments += 1;
        let visits = v.streams;
        self.dirty = true;
        // コメントのたびに書き込まないよう、まとめて保存する
        if self.last_flush.elapsed() > Duration::from_secs(10) {
            self.flush();
        }
        (first, visits)
    }

    pub fn flush(&mut self) {
        self.dirty = false;
        self.last_flush = Instant::now();
        let Some(p) = &self.path else { return };
        if let Some(d) = p.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        // 書きかけで壊れないよう、別名で書いてから置き換える
        let tmp = p.with_extension("tmp");
        if let Ok(mut f) = std::fs::File::create(&tmp) {
            for (id, v) in &self.map {
                let _ = writeln!(f, "{id}\t{}\t{}\t{}", v.streams, v.comments, v.last);
            }
            drop(f);
            let _ = std::fs::rename(&tmp, p);
        }
    }
}

impl Drop for Seen {
    // 切断・アプリ終了時に、まだ保存していない分を書き込む
    fn drop(&mut self) {
        if self.dirty {
            self.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cd-seen-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("youtube-test.txt")
    }

    #[test]
    fn counts_streams_not_comments() {
        let path = temp("count");
        {
            let mut s = Seen::from_path(Some(path.clone()));
            assert_eq!(s.record("UC1", "v1"), (true, 1));
            assert_eq!(s.record("UC1", "v1"), (false, 1)); // 同じ配信は数えない
            assert_eq!(s.record("UC1", "v2"), (false, 2));
            assert_eq!(s.record("UC2", "v2"), (true, 1));
            assert_eq!(s.record("", "v2"), (false, 0));
        } // drop で保存される
        let mut s2 = Seen::from_path(Some(path.clone()));
        assert_eq!(s2.record("UC1", "v3"), (false, 3));
        assert_eq!(s2.record("UC2", "v2"), (false, 1));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn reads_old_format() {
        let path = temp("old");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "UC1\nUC2\n").unwrap();
        let mut s = Seen::from_path(Some(path.clone()));
        assert_eq!(s.record("UC1", "v9"), (false, 2)); // 古い記録は配信 1 回として扱う
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
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
