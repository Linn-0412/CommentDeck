// CommentDeck の設定画面
import { Deck, DEFAULT_STYLE, ROLE_LABELS, PAID_LABELS, SHAPES } from "./shared/render.js";
import { DEFAULT_CONFIG, STARTER_RULES, THEMES, GOOGLE_FONTS, sampleMessages, nextTestMessage, newId } from "./shared/presets.js";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let config = DEFAULT_CONFIG();
let systemFonts = [];
let status = {};
const deck = new Deck(document.getElementById("preview-deck"));

// ------------------------------------------------------------ 小さな DOM ヘルパー

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "checked" || k === "value" || k === "disabled" || k === "selected") el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const row = (label, ctl, hint) =>
  h("div", { class: "row" }, h("label", {}, label), h("div", { class: "ctl" }, ctl), hint ? h("div", { class: "hint" }, hint) : null);

function color(get, set) {
  return h("input", { type: "color", value: get(), oninput: (e) => { set(e.target.value); changed(); } });
}

function range(min, max, step, get, set, unit = "") {
  const val = h("span", { class: "val" }, `${get()}${unit}`);
  const r = h("input", {
    type: "range", min, max, step, value: get(),
    oninput: (e) => { const v = Number(e.target.value); set(v); val.textContent = `${v}${unit}`; changed(); },
  });
  return [r, val];
}

function select(options, get, set) {
  const s = h("select", { onchange: (e) => { set(e.target.value); changed(); } },
    options.map(([v, label]) => h("option", { value: v, selected: String(get()) === String(v) }, label)));
  return s;
}

function check(label, get, set) {
  return h("label", { class: "check" },
    h("input", { type: "checkbox", checked: !!get(), onchange: (e) => { set(e.target.checked); changed(); } }), label);
}

function section(title, help, ...rows) {
  return h("div", { class: "section" }, h("h3", {}, title), help ? h("p", { class: "help" }, help) : null, ...rows);
}

// ------------------------------------------------------------ 保存・反映

let previewTimer = 0, saveTimer = 0;
const saveState = document.getElementById("save-state");

function changed() {
  deck.setConfig(config);
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => invoke("preview_config", { config }).catch(() => {}), 80);
  clearTimeout(saveTimer);
  saveState.textContent = "保存しています…";
  saveTimer = setTimeout(async () => {
    try { await invoke("save_config", { config }); saveState.textContent = "保存しました(変更は自動で保存されます)"; }
    catch (e) { saveState.textContent = "保存できませんでした: " + e; }
  }, 600);
}

function normalize(c) {
  const d = DEFAULT_CONFIG();
  if (!c || typeof c !== "object") return d;
  const conn = { ...d.connections, ...(c.connections || {}) };
  // 以前の版でチャンネル欄に配信の URL を入れていた場合は、URL 欄に移す
  if (!(c.connections || {}).youtubeMode && /(?:v=|youtu\.be\/|\/live\/)[\w-]{11}/.test(conn.youtube || "")) {
    conn.youtubeUrl = conn.youtube;
    conn.youtube = "";
    conn.youtubeMode = "url";
  }
  return {
    ...d, ...c,
    connections: conn,
    style: { ...DEFAULT_STYLE, ...(c.style || {}) },
    rules: Array.isArray(c.rules) ? c.rules : STARTER_RULES(),
  };
}

// ------------------------------------------------------------ タブ

document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab-body").forEach((t) => t.classList.toggle("hidden", t.id !== `tab-${b.dataset.tab}`));
  }));

function renderAll() {
  renderConnect();
  renderStyle();
  renderRules();
  renderThemes();
  renderAppTab();
}

// ------------------------------------------------------------ 接続

const STATE_CLASS = { connected: "ok", connecting: "wait", error: "err" };

function statusLine(platform) {
  const st = (status && status[platform]) || {};
  return h("div", { class: `status-line ${STATE_CLASS[st.state] || ""}`, id: `status-${platform}` },
    st.state && st.state !== "idle" ? st.detail : "接続していません");
}

/** 今つなぐ YouTube の接続先(チャンネル / 配信の URL のうち選んでいるほう)。 */
function youtubeTarget() {
  const c = config.connections;
  return c.youtubeMode === "url" ? c.youtubeUrl : c.youtube;
}

/** 初見の記録はチャンネル単位でまとめる(URL で接続するときもチャンネル欄を使う)。 */
function connectYouTube() {
  return invoke("connect_youtube", { input: youtubeTarget() || "", seenKey: config.connections.youtube || null });
}

function renderConnect() {
  const tab = document.getElementById("tab-connect");
  tab.innerHTML = "";
  const c = config.connections;
  const mode = (m, label, field, placeholder) => {
    const input = h("input", { type: "text", placeholder, value: c[field] || "",
      oninput: (e) => { c[field] = e.target.value.trim(); changed(); } });
    const radio = h("input", { type: "radio", name: "yt-mode", checked: (c.youtubeMode || "channel") === m,
      onchange: () => { c.youtubeMode = m; changed(); } });
    return h("div", { class: "row" }, h("label", { class: "check" }, radio, label), h("div", { class: "ctl" }, input));
  };
  const tw = h("input", { type: "text", placeholder: "チャンネル名(例: your_name)", value: config.connections.twitch,
    oninput: (e) => { config.connections.twitch = e.target.value.trim(); changed(); } });

  tab.append(
    section("YouTube", "どちらでつなぐかを選んで「接続」を押してください。両方の欄の内容は保存されるので、公開と限定公開の切り替えは選び直すだけです。",
      mode("channel", "チャンネルから探す", "youtube", "@ハンドル(例: @your_channel)"),
      mode("url", "配信の URL を指定", "youtubeUrl", "https://youtu.be/… など(限定公開のとき)"),
      h("p", { class: "help" }, "・チャンネルから探す: 公開の配信を自動で見つけます。配信前につないでおけば、始まるのを待ちます。"),
      h("p", { class: "help" }, "・配信の URL を指定: 限定公開の配信はチャンネルから見つからないので、こちらを使ってください。初見の判定のため、チャンネル欄も入れたままにしておいてください。メンバー限定の配信には対応していません。"),
      row("", [
        h("button", { class: "btn primary", onclick: () => connectYouTube() }, "接続"),
        h("button", { class: "btn", onclick: () => invoke("disconnect_youtube") }, "切断"),
      ]),
      statusLine("youtube")),
    section("Twitch", "チャンネル名を入れるだけで表示できます(ログインは不要です)。",
      row("チャンネル名", [tw]),
      row("", [
        h("button", { class: "btn primary", onclick: () => invoke("connect_twitch", { channel: config.connections.twitch }) }, "接続"),
        h("button", { class: "btn", onclick: () => invoke("disconnect_twitch") }, "切断"),
      ]),
      statusLine("twitch")),
    section("自動接続", null,
      row("", [check("CommentDeck を開いたら自動で接続する", () => config.autoConnect, (v) => (config.autoConnect = v))])),
    section("OBS に表示する", null,
      h("ol", { class: "steps" },
        h("li", {}, "上の「コピー」で URL をコピー"),
        h("li", {}, "OBS の「ソース」の ＋ →「ブラウザ」を追加"),
        h("li", {}, "URL に貼り付け、幅と高さを決めて OK(例: 600 × 900)"),
        h("li", {}, "見た目を変えると、OBS の表示もすぐに変わります"))),
    h("p", { class: "muted small" }, "※ YouTube のコメントは、YouTube の公式 API ではなく、チャット画面と同じ仕組みで読み込んでいます。YouTube の仕様変更で一時的に表示できなくなることがあります。"),
  );
}

function updateStatus(st) {
  status = st || {};
  for (const p of ["youtube", "twitch"]) {
    const s = status[p] || {};
    const chip = document.getElementById(`chip-${p}`);
    chip.className = `chip ${STATE_CLASS[s.state] || ""}`;
    chip.title = s.detail || "接続していません";
    const line = document.getElementById(`status-${p}`);
    if (line) {
      line.className = `status-line ${STATE_CLASS[s.state] || ""}`;
      line.textContent = s.state && s.state !== "idle" ? s.detail : "接続していません";
    }
  }
  const obs = document.getElementById("chip-obs");
  const n = status.overlayClients || 0;
  obs.className = `chip ${n > 0 ? "ok" : ""}`;
  obs.lastChild.textContent = n > 0 ? `OBS 表示中 (${n})` : "OBS";
  obs.title = n > 0 ? "OBS のブラウザソースがつながっています" : "OBS のブラウザソースはまだつながっていません";
}

// ------------------------------------------------------------ 見た目

function fontSelect() {
  const s = config.style;
  const current = `${s.fontSource}:${s.fontFamily}`;
  const sel = h("select", {
    onchange: (e) => {
      const [src, ...rest] = e.target.value.split(":");
      s.fontSource = src;
      s.fontFamily = rest.join(":");
      changed();
    },
  },
    h("optgroup", { label: "Google Fonts(おすすめ・OBS でも同じ見た目)" },
      GOOGLE_FONTS.map((f) => h("option", { value: `google:${f}`, selected: current === `google:${f}` }, f))),
    h("optgroup", { label: "この PC のフォント" },
      (systemFonts.length ? systemFonts : [s.fontSource === "system" ? s.fontFamily : "読み込み中…"]).map((f) =>
        h("option", { value: `system:${f}`, selected: current === `system:${f}` }, f))));
  return sel;
}

// ------------------------------------------------------------ 見本の小さなプレビュー(形・テーマを絵で選ぶため)

const MINI_MSGS = [
  { id: "m1", platform: "youtube", authorName: "みかん", authorIcon: "", roles: [], parts: [{ type: "text", text: "こんばんは！" }], text: "こんばんは！" },
  { id: "m2", platform: "youtube", authorName: "配信者", authorIcon: "", roles: ["owner"], parts: [{ type: "text", text: "ありがとう〜" }], text: "ありがとう〜" },
];

function miniPreview(style, rules = [], msgs = MINI_MSGS.slice(0, 1), cls = "sw") {
  const sw = h("div", { class: cls });
  const d = new Deck(sw);
  // 小さく見せるため、大きさ関係だけ縮める(形・色・フォントはそのまま)
  d.setConfig({
    style: { ...style, maxItems: msgs.length, animation: "none", maxWidth: 400, fontSize: 13, iconSize: 22,
      paddingY: Math.min(style.paddingY, 6), paddingX: Math.min(style.paddingX, 10), gap: 6, hideAfterSec: 0 },
    rules,
  });
  msgs.forEach((m) => d.add({ ...m }, false));
  return sw;
}

function renderStyle() {
  const tab = document.getElementById("tab-style");
  tab.innerHTML = "";
  const s = config.style;
  tab.append(
    section("吹き出しの形", "クリックで選べます。色や文字はそのままで、形だけ変わります。",
      h("div", { class: "shape-grid" }, SHAPES.map((shape) => {
        const tile = h("div", { class: `shape-tile ${s.shape === shape.id ? "selected" : ""}`, title: shape.label, onclick: () => {
          s.shape = shape.id;
          if (shape.id === "line" && s.bubbleLayout !== "outside") s.bubbleLayout = "outside"; // LINE 風は名前を外に出すと本物らしい
          renderStyle(); changed();
        } }, miniPreview(
          // 形が見やすいように、名前は出さず短いコメントで見せる
          { ...s, shape: shape.id, bubbleLayout: shape.id === "line" ? "outside" : s.bubbleLayout, showName: false, showPlatform: false,
            showIcon: false, layout: "top" },
          [], [{ ...MINI_MSGS[0], parts: [{ type: "text", text: "やっほー" }], text: "やっほー" }]), h("span", {}, shape.label));
        return tile;
      })),
      row("名前とアイコン", [select([["inside", "吹き出しの中"], ["outside", "吹き出しの外(LINE 風)"]], () => s.bubbleLayout, (v) => { s.bubbleLayout = v; renderStyle(); })])),
    section("文字", null,
      row("フォント", [fontSelect()], "この PC のフォントは、OBS を同じ PC で使う場合だけ正しく表示されます"),
      row("文字の大きさ", range(12, 64, 1, () => s.fontSize, (v) => (s.fontSize = v), "px")),
      row("太さ", [select([[400, "ふつう"], [700, "太字"], [900, "極太"]], () => s.fontWeight, (v) => (s.fontWeight = Number(v)))]),
      row("文字の色", [color(() => s.textColor, (v) => (s.textColor = v))]),
      row("文字のフチ", [...range(0, 6, 0.5, () => s.outlineWidth, (v) => (s.outlineWidth = v), "px"), color(() => s.outlineColor, (v) => (s.outlineColor = v))])),
    section("名前・アイコン", null,
      row("名前", [check("表示する", () => s.showName, (v) => (s.showName = v)), color(() => s.nameColor, (v) => (s.nameColor = v))]),
      row("", [check("Twitch の名前の色を使う", () => s.useTwitchColor, (v) => (s.useTwitchColor = v))]),
      row("名前の位置", [select([["top", "本文の上"], ["inline", "本文の横"]], () => s.nameLayout, (v) => (s.nameLayout = v))]),
      row("アイコン", [check("表示する", () => s.showIcon, (v) => (s.showIcon = v)), ...range(20, 72, 1, () => s.iconSize, (v) => (s.iconSize = v), "px")]),
      row("", [check("YouTube / Twitch の印", () => s.showPlatform, (v) => (s.showPlatform = v)), check("金額", () => s.showAmount, (v) => (s.showAmount = v))])),
    section("背景・枠", null,
      row("背景の色", [color(() => s.bgColor, (v) => (s.bgColor = v))]),
      row("背景の濃さ", range(0, 1, 0.05, () => s.bgOpacity, (v) => (s.bgOpacity = v))),
      row("角の丸み", range(0, 40, 1, () => s.radius, (v) => (s.radius = v), "px")),
      row("内側の余白(横)", range(0, 40, 1, () => s.paddingX, (v) => (s.paddingX = v), "px")),
      row("内側の余白(縦)", range(0, 30, 1, () => s.paddingY, (v) => (s.paddingY = v), "px")),
      row("枠線", [...range(0, 8, 1, () => s.borderWidth, (v) => (s.borderWidth = v), "px"), color(() => s.borderColor, (v) => (s.borderColor = v))]),
      row("", [check("影をつける", () => s.shadow, (v) => (s.shadow = v))]),
      row("", [check("スーパーチャットは YouTube の色にする", () => s.paidUsePlatformColor, (v) => (s.paidUsePlatformColor = v))])),
    section("並べ方・動き", null,
      row("並べ方", [select([["bottom", "下から積む(新しいコメントが下)"], ["top", "上から積む(新しいコメントが上)"]], () => s.layout, (v) => (s.layout = v))]),
      row("寄せる位置", [select([["left", "左"], ["right", "右"]], () => s.align, (v) => (s.align = v))]),
      row("表示する件数", range(1, 30, 1, () => s.maxItems, (v) => (s.maxItems = v), "件")),
      row("横幅の上限", range(200, 1400, 10, () => s.maxWidth, (v) => (s.maxWidth = v), "px")),
      row("コメントの間隔", range(0, 30, 1, () => s.gap, (v) => (s.gap = v), "px")),
      row("自動で消す", range(0, 120, 1, () => s.hideAfterSec, (v) => (s.hideAfterSec = v), "秒"), "0 秒なら消しません"),
      row("出てくるときの動き", [select([["slide", "スライド"], ["fade", "ふわっと"], ["pop", "ポップ"], ["none", "なし"]], () => s.animation, (v) => (s.animation = v))])),
  );
}

// ------------------------------------------------------------ ルール

const COND_TYPES = [
  ["text", "コメントに特定の文字を含む"],
  ["role", "コメントした人の種類"],
  ["paid", "投げ銭・ギフト"],
  ["visits", "常連さん(来てくれた回数)"],
  ["user", "特定のユーザー"],
  ["platform", "配信サービス"],
];

function newCondition(type) {
  switch (type) {
    case "text": return { type, mode: "contains", values: [""], caseSensitive: false };
    case "role": return { type, roles: [] };
    case "paid": return { type, kinds: [], minAmount: 0 };
    case "user": return { type, names: [""] };
    case "platform": return { type, platform: "youtube" };
    case "visits": return { type, min: 5 };
  }
}

const listText = (arr) => (arr || []).join("、");
const parseList = (s) => s.split(/[、,\n]/).map((x) => x.trim()).filter((x) => x.length > 0);

function conditionEditor(rule, c, idx) {
  const body = h("div", { class: "cond-body" });
  const typeSel = h("select", {
    onchange: (e) => { rule.conditions[idx] = newCondition(e.target.value); renderRules(); changed(); },
  }, COND_TYPES.map(([v, l]) => h("option", { value: v, selected: c.type === v }, l)));
  body.append(typeSel);

  if (c.type === "text") {
    body.append(
      h("input", { type: "text", placeholder: "例: 初見、草、こんにちは(、 区切りで複数)", value: listText(c.values),
        oninput: (e) => { c.values = parseList(e.target.value); changed(); } }),
      select([["contains", "のどれかを含む"], ["regex", "正規表現に合う(上級者向け)"]], () => c.mode, (v) => (c.mode = v)),
      check("大文字・小文字を区別", () => c.caseSensitive, (v) => (c.caseSensitive = v)));
  } else if (c.type === "role") {
    body.append(h("div", { class: "pill-group" }, Object.entries(ROLE_LABELS).map(([k, l]) =>
      check(l, () => (c.roles || []).includes(k), (v) => {
        c.roles = v ? [...new Set([...(c.roles || []), k])] : (c.roles || []).filter((x) => x !== k);
      }))), h("span", { class: "muted small" }, "のどれか(何も選ばないと合いません)"));
    if ((c.roles || []).includes("first")) {
      body.append(h("div", { class: "muted small", style: "flex-basis:100%" },
        "初見: Twitch は Twitch の「このチャンネルで初めての発言」を使います。YouTube は CommentDeck がこれまでに見たコメントをもとに判定するため、使い始めのうちは常連さんも初見になります。"));
    }
  } else if (c.type === "paid") {
    body.append(h("div", { class: "pill-group" }, Object.entries(PAID_LABELS).map(([k, l]) =>
      check(l, () => (c.kinds || []).includes(k), (v) => {
        c.kinds = v ? [...new Set([...(c.kinds || []), k])] : (c.kinds || []).filter((x) => x !== k);
      }))),
    h("span", { class: "muted small" }, "(何も選ばなければ全部)  金額・数が"),
    h("input", { type: "number", min: 0, value: c.minAmount || 0, oninput: (e) => { c.minAmount = Number(e.target.value) || 0; changed(); } }),
    h("span", { class: "muted small" }, "以上(通貨は区別しません)"));
  } else if (c.type === "user") {
    body.append(h("input", { type: "text", placeholder: "表示名(、 区切りで複数)", value: listText(c.names),
      oninput: (e) => { c.names = parseList(e.target.value); changed(); } }));
  } else if (c.type === "visits") {
    body.append(
      h("span", { class: "muted small" }, "コメントした配信が"),
      h("input", { type: "number", min: 1, value: c.min || 5, oninput: (e) => { c.min = Math.max(1, Number(e.target.value) || 1); changed(); } }),
      h("span", { class: "muted small" }, "回以上"),
      h("div", { class: "muted small", style: "flex-basis:100%" },
        "同じ配信で何回コメントしても 1 回と数えます(Twitch は 1 日 1 回)。CommentDeck を使い始めてから数えるので、効いてくるのは何回か配信してからです。ラベルに {visits} と書くと回数を表示できます。"));
  } else if (c.type === "platform") {
    body.append(select([["youtube", "YouTube のコメント"], ["twitch", "Twitch のコメント"]], () => c.platform, (v) => (c.platform = v)));
  }

  return h("div", { class: "cond" }, body,
    h("button", { class: "icon-btn", title: "この条件を消す", onclick: () => { rule.conditions.splice(idx, 1); renderRules(); changed(); } }, "✕"));
}

function effectEditor(rule) {
  const st = (rule.style = rule.style || {});
  // 「変える」にチェックしたものだけ上書きする
  const toggle = (key, label, defaultValue, ctl) => {
    const on = st[key] !== undefined && st[key] !== "";
    const cb = h("input", { type: "checkbox", checked: on, onchange: (e) => {
      if (e.target.checked) st[key] = defaultValue; else delete st[key];
      renderRules(); changed();
    } });
    return h("div", { class: "effect" }, h("label", { class: "check" }, cb, label), on ? ctl() : null);
  };
  return h("div", { class: "effect-grid" },
    toggle("bgColor", "背景の色", "#ff4d8d", () => color(() => st.bgColor, (v) => (st.bgColor = v))),
    toggle("bgOpacity", "背景の濃さ", 0.9, () => range(0, 1, 0.05, () => st.bgOpacity, (v) => (st.bgOpacity = v))[0]),
    toggle("textColor", "文字の色", "#ffffff", () => color(() => st.textColor, (v) => (st.textColor = v))),
    toggle("nameColor", "名前の色", "#ffd166", () => color(() => st.nameColor, (v) => (st.nameColor = v))),
    toggle("borderColor", "枠線の色", "#ffd166", () => color(() => st.borderColor, (v) => { st.borderColor = v; if (!st.borderWidth) st.borderWidth = 3; })),
    toggle("fontSize", "文字の大きさ", 28, () => h("input", { type: "number", min: 10, max: 96, value: st.fontSize, oninput: (e) => { st.fontSize = Number(e.target.value) || 22; changed(); } })),
    toggle("label", "ラベルを付ける", "注目", () => [
      h("input", { type: "text", value: st.label, style: "width:90px;flex:none", oninput: (e) => { st.label = e.target.value; changed(); } }),
      color(() => st.labelColor || "#ff4d8d", (v) => (st.labelColor = v))]),
    toggle("side", "右側に表示", "right", () => h("span", { class: "muted small" }, "(LINE の「自分」側のように)")),
    toggle("hide", "表示しない", true, () => h("span", { class: "muted small" }, "(NG ワードなど)")),
  );
}

function renderRules() {
  const tab = document.getElementById("tab-rules");
  tab.innerHTML = "";
  tab.append(h("p", { class: "muted small" },
    "「もし ○○ なら、見た目を △△ にする」を組み立てます。ルールは上から順に当てはめ、下のルールほど優先されます。"));
  config.rules.forEach((rule, i) => {
    const card = h("div", { class: `rule ${rule.enabled ? "" : "off"}` },
      h("div", { class: "rule-head" },
        h("label", { class: "check", title: "このルールを使う" },
          h("input", { type: "checkbox", checked: rule.enabled, onchange: (e) => { rule.enabled = e.target.checked; renderRules(); changed(); } })),
        h("input", { type: "text", value: rule.name, placeholder: "ルールの名前", oninput: (e) => { rule.name = e.target.value; changed(); } }),
        h("button", { class: "icon-btn", title: "上へ", disabled: i === 0, onclick: () => { [config.rules[i - 1], config.rules[i]] = [config.rules[i], config.rules[i - 1]]; renderRules(); changed(); } }, "↑"),
        h("button", { class: "icon-btn", title: "下へ", disabled: i === config.rules.length - 1, onclick: () => { [config.rules[i + 1], config.rules[i]] = [config.rules[i], config.rules[i + 1]]; renderRules(); changed(); } }, "↓"),
        h("button", { class: "icon-btn", title: "ルールを消す", onclick: () => { if (confirm(`ルール「${rule.name || "名前なし"}」を消しますか?`)) { config.rules.splice(i, 1); renderRules(); changed(); } } }, "🗑")),
      h("div", { class: "sub" }, "もし ",
        select([["all", "すべての条件"], ["any", "どれかの条件"]], () => rule.match, (v) => (rule.match = v)), " に当てはまったら"),
      ...(rule.conditions || []).map((c, ci) => conditionEditor(rule, c, ci)),
      h("button", { class: "btn small", onclick: () => { rule.conditions.push(newCondition("text")); renderRules(); changed(); } }, "＋ 条件を追加"),
      h("div", { class: "sub" }, "見た目をこう変える"),
      effectEditor(rule));
    tab.append(card);
  });
  tab.append(h("button", { class: "btn primary", onclick: () => {
    config.rules.push({ id: newId(), name: "新しいルール", enabled: true, match: "all", conditions: [newCondition("text")], style: { bgColor: "#ff4d8d" } });
    renderRules(); changed();
    tab.scrollTop = tab.scrollHeight;
  } }, "＋ ルールを追加"));
}

// ------------------------------------------------------------ テーマ

// テーマを当てたあとに「元に戻す」ため
let undoTheme = null;

/** テーマを当てる(見た目を置き換え、テーマ専用のルールがあれば追加)。 */
function applyTheme(t) {
  undoTheme = { style: { ...config.style }, rules: JSON.parse(JSON.stringify(config.rules)), name: t.name };
  config.style = { ...DEFAULT_STYLE, ...t.style };
  for (const r of t.rules || []) {
    if (!config.rules.some((x) => x.name === r.name)) config.rules.push({ ...JSON.parse(JSON.stringify(r)), id: newId() });
  }
  renderAll();
  changed();
  showUndo(t);
}

function showUndo(t) {
  saveState.innerHTML = "";
  saveState.append(`「${t.name}」の見た目にしました${(t.rules || []).length ? "(ルールも追加しました)" : ""} `,
    h("button", { class: "btn small", onclick: () => {
      if (!undoTheme) return;
      config.style = undoTheme.style; config.rules = undoTheme.rules; undoTheme = null;
      renderAll(); changed();
    } }, "元に戻す"));
}

/** テーマにマウスを乗せている間だけ、右のプレビューをそのテーマで表示する。 */
function hoverPreview(t) {
  if (t) deck.setConfig({ style: { ...DEFAULT_STYLE, ...t.style }, rules: [...config.rules, ...(t.rules || [])] });
  else deck.setConfig(config);
}

async function exportTheme() {
  const path = await invoke("plugin:dialog|save", { options: { defaultPath: "my-theme.commentdeck.json", filters: [{ name: "CommentDeck テーマ", extensions: ["json"] }] } });
  if (!path) return;
  const data = { app: "CommentDeck", version: 1, style: config.style, rules: config.rules };
  try { await invoke("write_text_file", { path, contents: JSON.stringify(data, null, 2) }); alert("テーマを書き出しました"); }
  catch (e) { alert(e); }
}

async function importTheme() {
  const path = await invoke("plugin:dialog|open", { options: { multiple: false, filters: [{ name: "CommentDeck テーマ", extensions: ["json"] }] } });
  if (!path) return;
  try {
    const data = JSON.parse(await invoke("read_text_file", { path }));
    if (!data || typeof data.style !== "object") throw new Error("CommentDeck のテーマファイルではありません");
    config.style = { ...DEFAULT_STYLE, ...data.style };
    if (Array.isArray(data.rules) && (config.rules.length === 0 || confirm("テーマに含まれるルールで、今のルールを置き換えますか?\n(キャンセルすると見た目だけ読み込みます)"))) {
      config.rules = data.rules;
    }
    renderAll(); changed();
  } catch (e) { alert("読み込めませんでした: " + (e.message || e)); }
}

function renderThemes() {
  const tab = document.getElementById("tab-themes");
  tab.innerHTML = "";
  tab.append(
    section("見本のテーマ", "マウスを乗せると右のプレビューで試せます。クリックでその見た目になります(あとで「元に戻す」もできます)。",
      h("div", { class: "theme-grid" }, THEMES.map((t) =>
        h("div", {
          class: "theme-card",
          onmouseenter: () => hoverPreview(t),
          onmouseleave: () => hoverPreview(null),
          onclick: () => applyTheme(t),
        }, miniPreview({ ...DEFAULT_STYLE, ...t.style }, [...config.rules, ...(t.rules || [])], MINI_MSGS, "sw big"),
        h("b", {}, t.name), h("span", { class: "muted small" }, t.description))))),
    section("テーマの共有", "見た目とルールをファイルに書き出して、ほかの人に渡したり、別の PC で使ったりできます。",
      row("", [
        h("button", { class: "btn", onclick: exportTheme }, "ファイルに書き出す"),
        h("button", { class: "btn", onclick: importTheme }, "ファイルから読み込む"),
      ])),
    section("初期設定に戻す", null,
      row("", [h("button", { class: "btn danger", onclick: () => {
        if (!confirm("見た目とルールを初期設定に戻しますか?(接続の設定は残ります)")) return;
        config.style = { ...DEFAULT_STYLE }; config.rules = STARTER_RULES(); renderAll(); changed();
      } }, "見た目とルールを初期設定に戻す")])),
  );
}

// ------------------------------------------------------------ アプリ・更新

let appVersion = "";

async function checkUpdate(manual) {
  const banner = document.getElementById("update-banner");
  try {
    const r = await invoke("check_update");
    if (r.available) {
      banner.innerHTML = "";
      banner.append(h("span", {}, `新しいバージョン v${r.version} があります。`),
        h("button", { class: "btn primary small", onclick: async (e) => {
          e.target.disabled = true; e.target.textContent = "更新しています…";
          try { await invoke("install_update"); } catch (err) { alert(err); e.target.disabled = false; e.target.textContent = "今すぐ更新"; }
        } }, "今すぐ更新"),
        h("button", { class: "btn small", onclick: () => banner.classList.add("hidden") }, "あとで"));
      banner.classList.remove("hidden");
    } else if (manual) {
      alert(`最新バージョンです(v${r.currentVersion})`);
    }
  } catch (e) {
    if (manual) alert(e);
  }
}

function renderAppTab() {
  const tab = document.getElementById("tab-app");
  tab.innerHTML = "";
  tab.append(
    section("バージョン", null,
      row("CommentDeck", [h("span", {}, `v${appVersion}`), h("button", { class: "btn small", onclick: () => checkUpdate(true) }, "更新を確認")]),
      h("p", { class: "help" }, "起動時に新しいバージョンがあるか自動で確認します。")),
    section("コメントした人の記録(初見・常連さん)", "「初見」(YouTube)と「常連さん」は、CommentDeck がコメントした人と来てくれた回数を記録して判定しています。記録を消すと、全員が初見・1 回目からやり直しになります。",
      row("", [h("button", { class: "btn danger", onclick: async () => {
        if (!confirm("コメントした人の記録(初見・常連さん)を消しますか?")) return;
        try {
          await invoke("reset_seen");
          // 接続中なら記録を読み直すためにつなぎ直す
          if (youtubeTarget() && (status.youtube || {}).state && status.youtube.state !== "idle") {
            await connectYouTube();
          }
          alert("記録を消しました");
        } catch (e) { alert(e); }
      } }, "記録を消す")])),
    section("オーバーレイのポート", "ほかのアプリとポートがぶつかったときだけ変えてください。変えたあとは CommentDeck を再起動し、OBS の URL も貼り直してください。",
      row("ポート番号", [h("input", { type: "number", min: 1024, max: 65535, value: config.port || 17890,
        onchange: (e) => { const v = Number(e.target.value); if (v >= 1024 && v <= 65535) { config.port = v; changed(); } } })])),
    section("リンク", null,
      row("", [h("button", { class: "btn", onclick: () => invoke("plugin:opener|open_url", { url: "https://github.com/Linn-0412/CommentDeck" }) }, "GitHub(使い方・不具合の報告)")])),
  );
}

// ------------------------------------------------------------ プレビューの操作

document.getElementById("preview-bg").addEventListener("change", (e) => {
  document.getElementById("preview-stage").className = `preview-stage bg-${e.target.value}`;
});
document.getElementById("btn-test").addEventListener("click", () => {
  const m = nextTestMessage();
  deck.add(m);
  invoke("send_test", { message: m }).catch(() => {});
});
document.getElementById("btn-samples").addEventListener("click", () => sampleMessages().forEach((m) => deck.add(m, false)));
// プレビューと OBS の両方から消す
document.getElementById("btn-clear").addEventListener("click", () => {
  deck.clear();
  invoke("clear_overlay").catch(() => {});
});

document.getElementById("copy-url").addEventListener("click", async (e) => {
  const url = document.getElementById("overlay-url").textContent;
  try { await navigator.clipboard.writeText(url); } catch { /* 選択してコピーしてもらう */ }
  e.target.textContent = "コピーしました";
  setTimeout(() => (e.target.textContent = "コピー"), 1500);
});

// ------------------------------------------------------------ 起動

async function init() {
  const data = await invoke("get_initial");
  appVersion = data.version;
  const firstRun = !data.config;
  config = normalize(data.config);
  document.getElementById("overlay-url").textContent = data.overlayUrl;
  renderAll();
  updateStatus(data.status);
  deck.setConfig(config);
  sampleMessages().forEach((m) => deck.add(m, false));
  if (firstRun) await invoke("save_config", { config });
  else invoke("preview_config", { config });

  await listen("chat", (e) => deck.add(e.payload));
  await listen("chat-delete", (e) => deck.remove(e.payload));
  await listen("status", (e) => updateStatus(e.payload));
  await listen("server-error", (e) => alert(e.payload));

  if (config.autoConnect) {
    if (youtubeTarget()) connectYouTube();
    if (config.connections.twitch) invoke("connect_twitch", { channel: config.connections.twitch });
  }

  invoke("list_fonts").then((f) => { systemFonts = f; renderStyle(); }).catch(() => {});
  setTimeout(() => checkUpdate(false), 3000);
}

init().catch((e) => alert("起動に失敗しました: " + e));
