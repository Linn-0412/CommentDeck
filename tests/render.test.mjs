import test from "node:test";
import assert from "node:assert/strict";
import { matchCondition, matchRule, evaluateRules, rgba } from "../ui/shared/render.js";
import { STARTER_RULES } from "../ui/shared/presets.js";

const msg = (o = {}) => ({ id: "1", platform: "youtube", authorName: "Taro", text: "初見です！よろしく", roles: [], paid: null, ...o });

test("text contains (複数・大文字小文字)", () => {
  assert.equal(matchCondition(msg(), { type: "text", mode: "contains", values: ["草", "初見"] }), true);
  assert.equal(matchCondition(msg({ text: "Hello" }), { type: "text", values: ["hello"], caseSensitive: false }), true);
  assert.equal(matchCondition(msg({ text: "Hello" }), { type: "text", values: ["hello"], caseSensitive: true }), false);
  assert.equal(matchCondition(msg(), { type: "text", values: [] }), false);
});

test("text regex(壊れた正規表現でも落ちない)", () => {
  assert.equal(matchCondition(msg({ text: "w".repeat(5) }), { type: "text", mode: "regex", values: ["^w{3,}$"] }), true);
  assert.equal(matchCondition(msg(), { type: "text", mode: "regex", values: ["(["] }), false);
});

test("role / user / platform", () => {
  assert.equal(matchCondition(msg({ roles: ["moderator"] }), { type: "role", roles: ["owner", "moderator"] }), true);
  assert.equal(matchCondition(msg(), { type: "role", roles: [] }), false);
  assert.equal(matchCondition(msg(), { type: "user", names: ["taro"] }), true);
  assert.equal(matchCondition(msg({ platform: "twitch" }), { type: "platform", platform: "youtube" }), false);
});

test("paid: 種類と金額", () => {
  const sc = msg({ paid: { kind: "superchat", amount: 1000 } });
  assert.equal(matchCondition(sc, { type: "paid", kinds: [], minAmount: 0 }), true);
  assert.equal(matchCondition(sc, { type: "paid", kinds: ["bits"], minAmount: 0 }), false);
  assert.equal(matchCondition(sc, { type: "paid", kinds: ["superchat"], minAmount: 5000 }), false);
  assert.equal(matchCondition(msg(), { type: "paid", kinds: [] }), false);
});

test("all / any と無効なルール", () => {
  const r = { enabled: true, match: "all", conditions: [{ type: "text", values: ["初見"] }, { type: "role", roles: ["member"] }] };
  assert.equal(matchRule(msg(), r), false);
  assert.equal(matchRule(msg(), { ...r, match: "any" }), true);
  assert.equal(matchRule(msg(), { ...r, match: "any", enabled: false }), false);
  assert.equal(matchRule(msg(), { enabled: true, match: "all", conditions: [] }), false);
});

test("evaluateRules: 下のルールが優先・ラベルは全部付く", () => {
  const rules = [
    { enabled: true, match: "all", conditions: [{ type: "text", values: ["初見"] }], style: { bgColor: "#111111", label: "A", labelColor: "#000" } },
    { enabled: true, match: "all", conditions: [{ type: "user", names: ["taro"] }], style: { bgColor: "#222222", label: "B" } },
  ];
  const o = evaluateRules(msg(), rules);
  assert.equal(o.bgColor, "#222222");
  assert.deepEqual(o.labels.map((l) => l.text), ["A", "B"]);
  assert.equal("labelColor" in o, false);
});

test("初期ルール: 初見・投げ銭・モデレーター", () => {
  const rules = STARTER_RULES();
  assert.equal(evaluateRules(msg(), rules).labels[0].text, "初見");
  assert.equal(evaluateRules(msg({ text: "hi", roles: ["first"] }), rules).labels[0].text, "初見");
  assert.equal(evaluateRules(msg({ text: "hi", paid: { kind: "bits", amount: 100 } }), rules).labels[0].text, "💰");
  assert.equal(evaluateRules(msg({ text: "hi", roles: ["moderator"] }), rules).nameColor, "#5ec8ff");
  assert.equal(evaluateRules(msg({ text: "hi" }), rules).labels.length, 0);
});

test("rgba", () => {
  assert.equal(rgba("#ff0000", 0.5), "rgba(255, 0, 0, 0.5)");
  assert.equal(rgba("#fff", 1), "rgba(255, 255, 255, 1)");
});

test("常連さん(visits)と {visits} ラベル", () => {
  assert.equal(matchCondition(msg({ visits: 5 }), { type: "visits", min: 5 }), true);
  assert.equal(matchCondition(msg({ visits: 4 }), { type: "visits", min: 5 }), false);
  assert.equal(matchCondition(msg({}), { type: "visits", min: 1 }), false); // 回数不明(0)は合わない
  const rules = STARTER_RULES();
  const o = evaluateRules(msg({ text: "hi", visits: 12 }), rules);
  assert.deepEqual(o.labels.map((l) => l.text), ["常連 12回目"]);
});
