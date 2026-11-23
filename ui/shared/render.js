// コメントの描画(OBS のオーバーレイと設定画面のプレビューで共通)。
// 見た目の設定(style)と、条件で見た目を変えるルール(rules)を解釈して DOM を作る。

export const DEFAULT_STYLE = {
  fontSource: "google",          // "google" / "system"
  fontFamily: "M PLUS Rounded 1c",
  fontSize: 22,
  fontWeight: 700,
  textColor: "#ffffff",
  nameColor: "#ffd166",
  useTwitchColor: true,          // Twitch の名前の色を使う
  bgColor: "#1b1b2f",
  bgOpacity: 0.72,
  radius: 14,
  paddingX: 14,
  paddingY: 9,
  gap: 8,
  borderColor: "#ffffff",
  borderWidth: 0,
  outlineColor: "#000000",
  outlineWidth: 0,               // 文字のフチ(px)
  shadow: true,
  showIcon: true,
  iconSize: 38,
  showName: true,
  nameLayout: "top",             // "top"(名前の下に本文)/ "inline"(横並び)
  showPlatform: true,
  showAmount: true,
  paidUsePlatformColor: true,    // スーパーチャットの色を背景に使う
  layout: "bottom",              // "bottom"(下から積む)/ "top"(上から積む)
  align: "left",                 // "left" / "right"
  maxItems: 8,
  maxWidth: 560,
  hideAfterSec: 0,               // 0 = 消さない
  animation: "slide",            // "slide" / "fade" / "pop" / "none"
};

export const ROLE_LABELS = {
  owner: "配信者",
  moderator: "モデレーター",
  member: "メンバーシップ(YouTube)/ サブスク(Twitch)",
  vip: "VIP",
  verified: "認証済み",
  first: "初見(チャンネルで初めて)",
};

export const PAID_LABELS = {
  superchat: "スーパーチャット",
  sticker: "スーパーステッカー",
  bits: "Bits(Twitch)",
  membership: "メンバー加入 / サブスク",
  gift: "ギフト",
};

// ------------------------------------------------------------ ルール

export function matchCondition(msg, c) {
  switch (c.type) {
    case "text": {
      const values = (c.values || []).map((v) => String(v)).filter((v) => v.length > 0);
      if (values.length === 0) return false;
      const text = msg.text || "";
      if (c.mode === "regex") {
        return values.some((v) => {
          try { return new RegExp(v, c.caseSensitive ? "" : "i").test(text); } catch { return false; }
        });
      }
      const hay = c.caseSensitive ? text : text.toLowerCase();
      return values.some((v) => hay.includes(c.caseSensitive ? v : v.toLowerCase()));
    }
    case "role":
      return (c.roles || []).some((r) => (msg.roles || []).includes(r));
    case "paid": {
      if (!msg.paid) return false;
      const kinds = c.kinds || [];
      if (kinds.length > 0 && !kinds.includes(msg.paid.kind)) return false;
      return (Number(msg.paid.amount) || 0) >= (Number(c.minAmount) || 0);
    }
    case "user": {
      const name = (msg.authorName || "").toLowerCase();
      return (c.names || []).some((n) => String(n).trim().toLowerCase() === name && name.length > 0);
    }
    case "platform":
      return msg.platform === c.platform;
    default:
      return false;
  }
}

export function matchRule(msg, rule) {
  const conds = rule.conditions || [];
  if (!rule.enabled || conds.length === 0) return false;
  return rule.match === "any" ? conds.some((c) => matchCondition(msg, c)) : conds.every((c) => matchCondition(msg, c));
}

/** 条件に合ったルールの見た目を、上から順に重ねる(下のルールほど優先)。 */
export function evaluateRules(msg, rules) {
  const out = {};
  const labels = [];
  for (const r of rules || []) {
    if (!matchRule(msg, r)) continue;
    const s = r.style || {};
    for (const [k, v] of Object.entries(s)) {
      if (v === undefined || v === null || v === "") continue;
      if (k === "label") labels.push({ text: v, color: s.labelColor || "#ff4d8d" });
      else if (k !== "labelColor") out[k] = v;
    }
  }
  out.labels = labels;
  return out;
}

// ------------------------------------------------------------ 色・フォント

export function rgba(hex, opacity) {
  const h = String(hex || "#000000").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6), 16);
  const a = Math.max(0, Math.min(1, Number(opacity)));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${isNaN(a) ? 1 : a})`;
}

// ------------------------------------------------------------ 表示できない文字の置き換え
// 一部のフォント(例: あずきフォント)は「〜」(U+301C)などの字形が空っぽで、何も表示されない。
// 字形がそもそも無ければブラウザが別のフォントで表示するが、空っぽの字形があると置き換わらない。
// そこで、選んだフォントで実際に描いてみて、何も描かれなかった文字だけ見た目の近い文字にする。

const ALTERNATES = {
  "〜": "～", // 〜 波ダッシュ → ～ 全角チルダ
  "−": "－", // − マイナス → － 全角ハイフンマイナス
  "‖": "∥", // ‖ → ∥
  "—": "―", // — → ―
  "¢": "￠", // ¢ → ￠
  "£": "￡", // £ → ￡
  "¬": "￢", // ¬ → ￢
};
const ALT_RE = new RegExp(`[${Object.keys(ALTERNATES).join("")}]`);
const inkCache = new Map(); // フォント名 → Map(文字 → 描けるか)
let inkCanvas = null;

function fontReady(font) {
  try { return document.fonts.check(`32px "${font}"`); } catch { return true; }
}

/** そのフォントでその文字を描いたとき、何か描かれるか。判定できなければ true(置き換えない)。 */
export function drawsInk(font, ch) {
  if (!font || typeof document === "undefined") return true;
  if (!fontReady(font)) return true; // まだ読み込み中のフォントは判定しない(あとのコメントで判定)
  let perFont = inkCache.get(font);
  if (!perFont) { perFont = new Map(); inkCache.set(font, perFont); }
  if (perFont.has(ch)) return perFont.get(ch);
  try {
    inkCanvas = inkCanvas || document.createElement("canvas");
    inkCanvas.width = inkCanvas.height = 48;
    const ctx = inkCanvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, 48, 48);
    // 指定したフォントだけを使う(字形が無ければ既定のフォントで描かれるので、それは「描ける」扱いになる)
    ctx.font = `32px "${font}"`;
    ctx.fillStyle = "#000";
    ctx.textBaseline = "middle";
    ctx.fillText(ch, 4, 24);
    const data = ctx.getImageData(0, 0, 48, 48).data;
    let ink = false;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) { ink = true; break; }
    perFont.set(ch, ink);
    return ink;
  } catch {
    return true;
  }
}

/** 選んだフォントで表示できない文字を、見た目の近い文字に置き換える。 */
export function fixGlyphs(text, font) {
  if (!text || !ALT_RE.test(text)) return text;
  return [...text].map((c) => (ALTERNATES[c] && !drawsInk(font, c) ? ALTERNATES[c] : c)).join("");
}

/** 色の明るさ(0 = 黒 〜 1 = 白)。 */
export function luminance(hex) {
  const h = String(hex || "#000000").replace("#", "").padEnd(6, "0").slice(0, 6);
  const n = parseInt(h, 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

const loadedFonts = new Set();
export function ensureFont(style) {
  if (style.fontSource !== "google" || !style.fontFamily || loadedFonts.has(style.fontFamily)) return;
  loadedFonts.add(style.fontFamily);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(style.fontFamily).replace(/%20/g, "+")}:wght@400;700;900&display=swap`;
  document.head.appendChild(link);
}

function outlineShadow(width, color) {
  if (!width) return "";
  const w = Number(width);
  const pts = [];
  for (let a = 0; a < 360; a += 30) {
    const r = (a * Math.PI) / 180;
    pts.push(`${(Math.cos(r) * w).toFixed(2)}px ${(Math.sin(r) * w).toFixed(2)}px 0 ${color}`);
  }
  return pts.join(", ");
}

// ------------------------------------------------------------ 描画

const STYLE_TEXT = `
.cd-deck { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden;
  padding: 12px; box-sizing: border-box; pointer-events: none; }
.cd-deck.layout-bottom { justify-content: flex-end; }
.cd-deck.layout-top { justify-content: flex-start; }
.cd-deck.align-left { align-items: flex-start; }
.cd-deck.align-right { align-items: flex-end; }
.cd-item { display: flex; align-items: flex-start; gap: 10px; box-sizing: border-box; max-width: var(--max-width);
  font-family: var(--font), "Yu Gothic UI", "Hiragino Sans", sans-serif; font-weight: var(--weight); font-size: var(--size);
  color: var(--text); background: var(--bg); border: var(--border-w) solid var(--border); border-radius: var(--radius);
  padding: var(--py) var(--px); margin-top: var(--gap); line-height: 1.35; word-break: break-word; }
.cd-deck.layout-top .cd-item { margin-top: 0; margin-bottom: var(--gap); }
.cd-item.shadow { box-shadow: 0 4px 14px rgba(0,0,0,.35); }
.cd-icon { width: var(--icon); height: var(--icon); border-radius: 50%; flex: none; object-fit: cover; background: rgba(255,255,255,.15); }
.cd-icon.placeholder { display: flex; align-items: center; justify-content: center; font-size: calc(var(--icon) * .45); color: #fff; }
.cd-body { min-width: 0; }
.cd-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: .78em; color: var(--name); margin-bottom: 2px; }
.cd-item.inline .cd-body { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.cd-item.inline .cd-head { margin-bottom: 0; }
.cd-name { font-weight: 700; }
.cd-plat { width: .7em; height: .7em; border-radius: 50%; display: inline-block; flex: none; }
.cd-plat.youtube { background: #ff0033; }
.cd-plat.twitch { background: #9146ff; }
.cd-label { font-size: .85em; padding: 0 .5em; border-radius: .6em; color: #fff; font-weight: 700; }
.cd-amount { font-size: .9em; padding: 0 .5em; border-radius: .6em; background: rgba(0,0,0,.28); color: #fff; font-weight: 700; }
.cd-text { color: var(--text); }
.cd-text img { height: 1.4em; vertical-align: -.35em; margin: 0 .05em; }
.cd-text img.sticker { height: 4em; vertical-align: middle; }
.cd-item.anim-slide.enter { animation: cd-slide .35s ease-out; }
.cd-deck.align-right .cd-item.anim-slide.enter { animation-name: cd-slide-r; }
.cd-item.anim-fade.enter { animation: cd-fade .4s ease-out; }
.cd-item.anim-pop.enter { animation: cd-pop .35s cubic-bezier(.2,1.6,.4,1); }
.cd-item.leave { animation: cd-fade .4s ease-in reverse forwards; }
@keyframes cd-slide { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: none; } }
@keyframes cd-slide-r { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: none; } }
@keyframes cd-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes cd-pop { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const el = document.createElement("style");
  el.textContent = STYLE_TEXT;
  document.head.appendChild(el);
}

export class Deck {
  constructor(root) {
    injectCss();
    this.root = root;
    this.root.classList.add("cd-deck");
    this.config = { style: { ...DEFAULT_STYLE }, rules: [] };
    this.timers = new Map();
    this.messages = []; // 見た目を変えたときに描き直すため
  }

  get style() {
    return { ...DEFAULT_STYLE, ...(this.config.style || {}) };
  }

  setConfig(config) {
    this.config = { style: { ...DEFAULT_STYLE, ...((config && config.style) || {}) }, rules: (config && config.rules) || [] };
    const s = this.style;
    ensureFont(s);
    this.root.className = `cd-deck layout-${s.layout} align-${s.align}`;
    // 描き直す(アニメーションなし)
    const msgs = this.messages.slice();
    this.root.innerHTML = "";
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this.messages = [];
    for (const m of msgs) this.add(m, false);
  }

  add(msg, animate = true) {
    const base = this.style;
    const over = evaluateRules(msg, this.config.rules);
    if (over.hide) return;
    const s = { ...base, ...over };
    const el = this.build(msg, s, over);
    if (animate && s.animation !== "none") el.classList.add(`anim-${s.animation}`, "enter");
    if (s.layout === "top") this.root.prepend(el);
    else this.root.append(el);
    this.messages.push(msg);

    // 多すぎる分を古い順に消す
    const max = Math.max(1, Number(s.maxItems) || 1);
    const items = [...this.root.querySelectorAll(".cd-item:not(.leave)")];
    const extra = items.length - max;
    if (extra > 0) {
      const old = s.layout === "top" ? items.slice(-extra) : items.slice(0, extra);
      old.forEach((o) => this.removeEl(o, false));
    }
    if (this.messages.length > 200) this.messages = this.messages.slice(-max);

    const sec = Number(s.hideAfterSec) || 0;
    if (sec > 0 && animate) {
      const t = setTimeout(() => this.removeEl(el, true), sec * 1000);
      this.timers.set(el, t);
    }
  }

  remove(id) {
    this.root.querySelectorAll(`.cd-item[data-id="${CSS.escape(id)}"]`).forEach((el) => this.removeEl(el, true));
  }

  clear() {
    this.messages = [];
    this.root.innerHTML = "";
  }

  removeEl(el, animate) {
    const id = el.dataset.id;
    this.messages = this.messages.filter((m) => m.id !== id);
    clearTimeout(this.timers.get(el));
    this.timers.delete(el);
    if (!animate) { el.remove(); return; }
    el.classList.remove("enter");
    el.classList.add("leave");
    setTimeout(() => el.remove(), 420);
  }

  build(msg, s, over) {
    const labels = over.labels || [];
    const el = document.createElement("div");
    el.className = "cd-item" + (s.nameLayout === "inline" ? " inline" : "") + (s.shadow ? " shadow" : "");
    el.dataset.id = msg.id || "";

    // スーパーチャットは YouTube の色を背景に(ルールで背景色を指定していればそちらを優先)
    let bg = rgba(s.bgColor, s.bgOpacity);
    let textColor = s.textColor;
    // Twitch の名前の色(ルールで名前の色を指定していればそちらを優先)
    let nameColor = s.useTwitchColor && msg.authorColor && !("nameColor" in over) ? msg.authorColor : s.nameColor;
    if (msg.paid && msg.paid.color && s.paidUsePlatformColor && !("bgColor" in over)) {
      bg = rgba(msg.paid.color, Math.max(0.85, Number(s.bgOpacity) || 0));
      // 黄色などの明るい色では白い文字が読めないので、文字を暗くする(ルールの指定は優先)
      if (luminance(msg.paid.color) > 0.55) {
        if (!("textColor" in over)) textColor = "#1a1a1a";
        if (!("nameColor" in over)) nameColor = "#3d3d3d";
      }
    }
    const vars = {
      "--font": s.fontFamily ? `"${s.fontFamily}"` : "inherit",
      "--size": `${s.fontSize}px`,
      "--weight": s.fontWeight,
      "--text": textColor,
      "--name": nameColor,
      "--bg": bg,
      "--radius": `${s.radius}px`,
      "--px": `${s.paddingX}px`,
      "--py": `${s.paddingY}px`,
      "--gap": `${s.gap}px`,
      "--border": s.borderColor,
      "--border-w": `${s.borderWidth}px`,
      "--icon": `${s.iconSize}px`,
      "--max-width": `${s.maxWidth}px`,
    };
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, String(v));
    const outline = outlineShadow(s.outlineWidth, s.outlineColor);
    if (outline) el.style.textShadow = outline;

    if (s.showIcon) {
      if (msg.authorIcon) {
        const img = document.createElement("img");
        img.className = "cd-icon";
        img.src = msg.authorIcon;
        img.referrerPolicy = "no-referrer";
        el.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "cd-icon placeholder";
        ph.textContent = (msg.authorName || "?").slice(0, 1);
        ph.style.background = msg.platform === "twitch" ? "#9146ff" : "#ff0033";
        el.appendChild(ph);
      }
    }

    const body = document.createElement("div");
    body.className = "cd-body";
    const head = document.createElement("div");
    head.className = "cd-head";
    if (s.showPlatform) {
      const p = document.createElement("span");
      p.className = `cd-plat ${msg.platform}`;
      head.appendChild(p);
    }
    for (const l of labels) {
      const lab = document.createElement("span");
      lab.className = "cd-label";
      lab.textContent = l.text;
      lab.style.background = l.color;
      head.appendChild(lab);
    }
    if (s.showName) {
      const n = document.createElement("span");
      n.className = "cd-name";
      n.textContent = fixGlyphs(msg.authorName || "", s.fontFamily);
      head.appendChild(n);
    }
    if (s.showAmount && msg.paid && msg.paid.amountText && (msg.paid.kind === "superchat" || msg.paid.kind === "sticker" || msg.paid.kind === "bits")) {
      const a = document.createElement("span");
      a.className = "cd-amount";
      a.textContent = msg.paid.amountText;
      head.appendChild(a);
    }
    if (head.childNodes.length > 0) body.appendChild(head);

    const text = document.createElement("div");
    text.className = "cd-text";
    for (const part of msg.parts && msg.parts.length ? msg.parts : [{ type: "text", text: msg.text || "" }]) {
      if (part.type === "emoji") {
        const img = document.createElement("img");
        img.src = part.url;
        img.alt = part.alt || "";
        img.referrerPolicy = "no-referrer";
        if (part.alt === "sticker") img.className = "sticker";
        text.appendChild(img);
      } else {
        text.appendChild(document.createTextNode(fixGlyphs(part.text || "", s.fontFamily)));
      }
    }
    body.appendChild(text);
    el.appendChild(body);
    return el;
  }
}
