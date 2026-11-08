// 运行：node editor/import_export_test.js
"use strict";
const P = require("./preset.js");
const IO = require("./import_export.js");
let passed = 0;
function ok(name) { passed++; console.log("PASS", name); }
function assert(cond, msg) { if (!cond) throw new Error(`assert: ${msg}`); }
function equal(actual, expected, name) { assert(Object.is(actual, expected), `${name}: ${actual} != ${expected}`); ok(name); }
function throws(fn, pattern, name) {
  let error = null;
  try { fn(); } catch (caught) { error = caught; }
  assert(error && pattern.test(error.message), `${name}: ${error?.message || "did not throw"}`);
  ok(name);
}

const source = P.createEmptyPreset(42, "剪辑预设");
source.platform = "mac";
source.accent = [49, 168, 255];
source.rgbMode = 8;
source.actions[0] = { kind: 1, mods: 10, code: 29, wheelDy: 0 };
source.actions[16] = { kind: 3, mods: 4, code: 0, wheelDy: -2 };
const original = JSON.stringify(source);
const text = IO.serializePreset(source);
const parsed = IO.parsePreset(text);
equal(JSON.stringify(parsed), JSON.stringify(source), "formatted JSON round trip preserves preset data");
equal(JSON.stringify(source), original, "serialization does not mutate source");
const envelope = JSON.parse(text);
equal(envelope.schemaVersion, 1, "export schemaVersion");
equal(envelope.product, "navio-chron", "export product");
equal(envelope.record, 1, "export record version");
equal(envelope.metadata.author, "local", "export metadata remains compatible");
equal(IO.parsePreset(`\uFEFF${JSON.stringify(envelope)}`).name, "剪辑预设", "BOM and minified JSON are accepted");
equal(IO.parsePreset(text).actions.length, 22, "all action slots including SideKey survive");
equal(IO.parsePreset(text).actions[15].kind, 0, "locked SideKey slot survives");

const withInternal = P.clonePreset(source);
withInternal._installedId = 7;
withInternal._dirty = true;
withInternal.uuid = "internal";
const cleaned = IO.parsePreset(IO.serializePreset(withInternal));
assert(!("_installedId" in cleaned) && !("_dirty" in cleaned) && !("uuid" in cleaned), "page-internal fields never enter export");
ok("page-internal fields never enter export");

throws(() => IO.parsePreset("   "), /内容为空/, "blank import rejected");
throws(() => IO.parsePreset("{"), /JSON 语法错误/, "malformed JSON rejected");
throws(() => IO.parsePreset("[]"), /根节点/, "array root rejected");
throws(() => IO.parsePreset("{}"), /不支持/, "missing envelope rejected");
throws(() => IO.parsePreset(JSON.stringify({ ...envelope, schemaVersion: 2 })), /不支持/, "future schema rejected");
throws(() => IO.parsePreset(JSON.stringify({ ...envelope, record: 2 })), /不支持/, "future record rejected");
throws(() => IO.parsePreset(JSON.stringify({ ...envelope, product: "other" })), /不支持/, "wrong product rejected");
throws(() => IO.parsePreset(JSON.stringify({ ...envelope, preset: null })), /不支持|preset/, "missing preset rejected");
throws(() => IO.parsePreset(JSON.stringify({ ...envelope, preset: { ...source, id: 0 } })), /预设内容无效/, "invalid ID rejected");
throws(() => IO.parsePreset(JSON.stringify({ ...envelope, preset: { ...source, actions: source.actions.slice(1) } })), /预设内容无效/, "wrong action count rejected");
const invalidAction = P.clonePreset(source);
invalidAction.actions[0] = { kind: 3, mods: 0, code: 0, wheelDy: 1 };
throws(() => IO.parsePreset(JSON.stringify({ ...envelope, preset: invalidAction })), /预设内容无效/, "Wheel on a button rejected");
throws(() => IO.parsePreset(JSON.stringify({ ...envelope, preset: { ...source, platform: "android" } })), /不支持的平台/, "unknown platform rejected");
throws(() => IO.parsePreset(JSON.stringify({ ...envelope, preset: { ...source, name: "x".repeat(24) } })), /预设内容无效/, "overlong UTF-8 name rejected");
throws(() => IO.parsePreset(` ${" ".repeat(IO.MAX_IMPORT_BYTES + 1)} `), /过大/, "oversized input rejected");
throws(() => IO.serializePreset({ ...source, id: 999 }), /预设内容无效/, "invalid preset cannot be exported");

console.log(`\nAll ${passed} checks passed.`);
