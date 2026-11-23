use serde::Serialize;

/// 配信先に関係なく共通のコメント。オーバーレイとプレビューはこの形を描画する。
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    /// "youtube" / "twitch"
    pub platform: String,
    /// 投稿者の ID(YouTube はチャンネル ID、Twitch はユーザー ID)。表示名が変わっても同じ。
    pub author_id: String,
    pub author_name: String,
    pub author_icon: String,
    /// Twitch の名前の色など(なければ空)
    pub author_color: String,
    /// "owner" / "moderator" / "member" / "vip" / "verified" / "first"
    pub roles: Vec<String>,
    pub parts: Vec<Part>,
    /// 条件判定用のプレーンテキスト
    pub text: String,
    pub paid: Option<Paid>,
    pub timestamp: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Part {
    Text { text: String },
    Emoji { url: String, alt: String },
}

/// 投げ銭・ギフト・メンバー加入など。
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Paid {
    /// "superchat" / "sticker" / "bits" / "membership" / "gift"
    pub kind: String,
    /// 表示用(例: "¥1,000" / "100 bits")
    pub amount_text: String,
    /// 条件判定用の数値(通貨は区別しない)
    pub amount: f64,
    /// YouTube のスーパーチャットの色(#rrggbb、なければ空)
    pub color: String,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// "¥1,000" / "$5.00" / "€5,00" などから数値を取り出す。
pub fn parse_amount(text: &str) -> f64 {
    let digits: String = text
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
        .collect();
    let normalized = if digits.contains('.') && digits.contains(',') {
        digits.replace(',', "")
    } else if let Some(pos) = digits.rfind(',') {
        // "1,000" は桁区切り、"5,00" は小数点
        if digits.len() - pos - 1 == 3 {
            digits.replace(',', "")
        } else {
            digits.replace(',', ".")
        }
    } else {
        digits
    };
    normalized.trim_matches('.').parse().unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::parse_amount;

    #[test]
    fn amounts() {
        assert_eq!(parse_amount("¥1,000"), 1000.0);
        assert_eq!(parse_amount("$5.00"), 5.0);
        assert_eq!(parse_amount("€5,00"), 5.0);
        assert_eq!(parse_amount("₩10,000"), 10000.0);
        assert_eq!(parse_amount("NT$1,234.50"), 1234.5);
        assert_eq!(parse_amount(""), 0.0);
    }
}
