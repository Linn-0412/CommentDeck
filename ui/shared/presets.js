// 初期設定・見本のテーマ・おすすめフォント・プレビュー用のコメント
import { DEFAULT_STYLE } from "./render.js";

let ruleSeq = 0;
export const newId = (p = "r") => `${p}${Date.now().toString(36)}${(ruleSeq++).toString(36)}`;

export const STARTER_RULES = () => [
  {
    id: newId(), name: "投げ銭・ギフト", enabled: true, match: "all",
    conditions: [{ type: "paid", kinds: [], minAmount: 0 }],
    style: { borderColor: "#ffd166", borderWidth: 3, label: "💰", labelColor: "#e8a400" },
  },
  {
    id: newId(), name: "初見さん", enabled: true, match: "any",
    conditions: [{ type: "text", mode: "contains", values: ["初見"], caseSensitive: false }, { type: "role", roles: ["first"] }],
    style: { bgColor: "#ff4d8d", bgOpacity: 0.85, label: "初見", labelColor: "#c2185b" },
  },
  {
    id: newId(), name: "常連さん", enabled: true, match: "all",
    conditions: [{ type: "visits", min: 5 }],
    style: { label: "常連 {visits}回目", labelColor: "#00897b" },
  },
  {
    id: newId(), name: "モデレーター", enabled: true, match: "all",
    conditions: [{ type: "role", roles: ["moderator"] }],
    style: { nameColor: "#5ec8ff", label: "MOD", labelColor: "#1e88e5" },
  },
  {
    id: newId(), name: "配信者", enabled: true, match: "all",
    conditions: [{ type: "role", roles: ["owner"] }],
    style: { bgColor: "#6c3bd1", bgOpacity: 0.9, label: "配信者", labelColor: "#4a148c" },
  },
];

export const DEFAULT_CONFIG = () => ({
  version: 1,
  port: 17890,
  autoConnect: true,
  // youtube: チャンネル(@ハンドル)/ youtubeUrl: 配信の URL(限定公開用)/ youtubeMode: どちらを使うか
  connections: { youtube: "", youtubeUrl: "", youtubeMode: "channel", twitch: "" },
  style: { ...DEFAULT_STYLE },
  rules: STARTER_RULES(),
});

export const THEMES = [
  { name: "スタンダード", description: "暗めの背景で読みやすい", style: { ...DEFAULT_STYLE } },
  {
    name: "ポップ", description: "明るい色の吹き出し",
    style: { ...DEFAULT_STYLE, fontFamily: "Mochiy Pop One", fontWeight: 400, textColor: "#3a2a4d", nameColor: "#ff4d8d",
      bgColor: "#fff4fb", bgOpacity: 0.95, radius: 22, borderColor: "#ff9ac8", borderWidth: 3, animation: "pop" },
  },
  {
    name: "シンプル(背景なし)", description: "文字にフチだけ。ゲーム画面の上に",
    style: { ...DEFAULT_STYLE, fontFamily: "Zen Maru Gothic", bgOpacity: 0, shadow: false, outlineWidth: 2.5,
      outlineColor: "#000000", showIcon: false, nameLayout: "inline", animation: "fade" },
  },
  {
    name: "ネオン", description: "黒地に光る枠",
    style: { ...DEFAULT_STYLE, fontFamily: "DotGothic16", fontWeight: 400, textColor: "#e0fbff", nameColor: "#39ff14",
      bgColor: "#05010f", bgOpacity: 0.85, radius: 6, borderColor: "#00e5ff", borderWidth: 2, animation: "slide" },
  },
  {
    name: "やわらか", description: "淡い色で配信画面になじむ",
    style: { ...DEFAULT_STYLE, fontFamily: "Kosugi Maru", fontWeight: 400, textColor: "#4a4a4a", nameColor: "#8a6fd1",
      bgColor: "#fdf6ec", bgOpacity: 0.9, radius: 18, shadow: true, animation: "fade" },
  },
  {
    name: "LINE 風", description: "白い吹き出し。配信者のコメントは右側・緑",
    style: { ...DEFAULT_STYLE, fontFamily: "Noto Sans JP", fontWeight: 400, textColor: "#111111", nameColor: "#ffffff",
      useTwitchColor: false, bgColor: "#ffffff", bgOpacity: 1, radius: 20, paddingX: 16, paddingY: 10, shadow: false,
      shape: "line", bubbleLayout: "outside", iconSize: 42, showPlatform: false, animation: "pop" },
    // このテーマと一緒に追加するルール(LINE の「自分」側の見た目)
    rules: [{ name: "配信者は右側・緑(LINE 風)", enabled: true, match: "all", conditions: [{ type: "role", roles: ["owner"] }],
      style: { bgColor: "#41d34c", bgOpacity: 1, textColor: "#111111", side: "right" } }],
  },
  {
    name: "しっぽ付き吹き出し", description: "マンガのような吹き出し",
    style: { ...DEFAULT_STYLE, fontFamily: "Zen Maru Gothic", textColor: "#222222", nameColor: "#e4572e", bgColor: "#ffffff",
      bgOpacity: 0.95, radius: 16, shape: "speech", borderColor: "#222222", borderWidth: 0, animation: "pop" },
  },
  {
    name: "カプセル", description: "まるいカプセル型でスッキリ",
    style: { ...DEFAULT_STYLE, fontFamily: "M PLUS Rounded 1c", bgColor: "#2d2a55", bgOpacity: 0.8, nameColor: "#ffb4e6",
      shape: "pill", nameLayout: "inline", iconSize: 30, animation: "slide" },
  },
  {
    name: "付箋", description: "左に名前の色の帯",
    style: { ...DEFAULT_STYLE, fontFamily: "Klee One", fontWeight: 400, textColor: "#3b3b3b", nameColor: "#ff8a3d",
      bgColor: "#fffbea", bgOpacity: 0.95, shape: "tag", showIcon: false, animation: "slide" },
  },
  {
    name: "テロップ(下線)", description: "背景なし。文字と下線だけ",
    style: { ...DEFAULT_STYLE, fontFamily: "Dela Gothic One", fontWeight: 400, textColor: "#ffffff", nameColor: "#00e0ff",
      shape: "underline", outlineWidth: 2, outlineColor: "#000000", shadow: false, showIcon: false, nameLayout: "inline", animation: "fade" },
  },
];

// 日本語が表示できる Google Fonts(OBS はインターネットから読み込みます)
export const GOOGLE_FONTS = [
  "M PLUS Rounded 1c", "Noto Sans JP", "Zen Maru Gothic", "Kosugi Maru", "Mochiy Pop One", "Dela Gothic One",
  "DotGothic16", "RocknRoll One", "Reggae One", "Kiwi Maru", "Zen Kaku Gothic New", "Sawarabi Gothic",
  "Hachi Maru Pop", "Yusei Magic", "Potta One", "Rampart One", "Train One", "Stick", "Yomogi", "Klee One",
  "Murecho", "BIZ UDPGothic", "Noto Serif JP", "Shippori Mincho",
];

const sampleIcon = (c) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${c}"/><circle cx="20" cy="16" r="7" fill="#fff" opacity=".9"/><rect x="9" y="26" width="22" height="12" rx="6" fill="#fff" opacity=".9"/></svg>`)}`;

let sampleSeq = 0;
export function sampleMessages() {
  const t = Date.now();
  const mk = (o) => ({ id: `sample-${t}-${sampleSeq++}`, roles: [], authorColor: "", paid: null, timestamp: t, visits: 2, ...o,
    parts: [{ type: "text", text: o.text }] });
  return [
    mk({ platform: "youtube", authorName: "みかん", authorIcon: sampleIcon("#ff9f43"), text: "こんばんは〜！今日も楽しみにしてました", visits: 12 }),
    mk({ platform: "twitch", authorName: "night_owl", authorIcon: "", authorColor: "#7ee081", text: "初見です！よろしくお願いします", roles: ["first"], visits: 1 }),
    mk({ platform: "youtube", authorName: "さくら", authorIcon: sampleIcon("#ff6b9d"), text: "応援してます！", roles: ["member"],
      paid: { kind: "superchat", amountText: "¥1,000", amount: 1000, color: "#ffca28" } }),
    mk({ platform: "twitch", authorName: "ModBot", authorIcon: "", authorColor: "#5ec8ff", text: "ルールを守って楽しく見ましょう", roles: ["moderator"] }),
    mk({ platform: "youtube", authorName: "配信者", authorIcon: sampleIcon("#6c5ce7"), text: "みんなコメントありがとう！", roles: ["owner"] }),
    mk({ platform: "twitch", authorName: "gamer_kun", authorIcon: "", authorColor: "#ff7f50", text: "Cheer100 ナイスプレイ！",
      paid: { kind: "bits", amountText: "100 bits", amount: 100, color: "" } }),
  ];
}

/** テスト用のコメントを 1 件(押すたびに違う種類)。 */
let testIndex = 0;
export function nextTestMessage() {
  const all = sampleMessages();
  const m = all[testIndex++ % all.length];
  return { ...m, id: `test-${Date.now()}-${testIndex}`, timestamp: Date.now() };
}
