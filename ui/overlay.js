// OBS のブラウザソースで表示するページ。アプリから WebSocket でコメントと見た目を受け取る。
import { Deck } from "./shared/render.js";

const deck = new Deck(document.getElementById("deck"));

function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    if (data.type === "config") deck.setConfig(data.config || {});
    else if (data.type === "message") deck.add(data.message);
    else if (data.type === "delete") deck.remove(data.id);
    else if (data.type === "clear") deck.clear();
  };
  // アプリを閉じて開き直しても自動でつなぎ直す
  ws.onclose = () => setTimeout(connect, 2000);
  ws.onerror = () => ws.close();
}
connect();
