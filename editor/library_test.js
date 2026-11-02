// 运行：node editor/library_test.js
"use strict";
const L = require("./library.js");
const P = require("./preset.js");
let passed = 0;
function ok(name) { passed++; console.log("PASS", name); }
function assert(cond, msg) { if (!cond) throw new Error(`assert: ${msg}`); }
function equal(actual, expected, name) { assert(Object.is(actual, expected), `${name}: ${actual} != ${expected}`); ok(name); }
function throws(fn, name) { try { fn(); } catch (_) { ok(name); return; } throw new Error(`${name}: expected error`); }
const template = { name: "JianYing Win", accent: [0, 170, 170], actions: [], _readonly: true, templateId: "JianYing Win" };
const custom = { uuid: "user-1", id: 9, name: "mine", originTemplateId: "JianYing Win", originTemplateVersion: 0, actions: [] };

equal(L.SCHEMA_VERSION, 2, "library schema is version 2");
equal(L.migrateLegacy(null).userPresets.length, 0, "empty storage starts with no user presets");
throws(() => L.migrateLegacy({ schemaVersion: 3, userPresets: [custom] }), "future library schema is rejected");
throws(() => L.migrateLegacy({ schemaVersion: 2, userPresets: null }), "malformed current library is rejected");
const legacy = L.migrateLegacy({ schemaVersion: 1, presets: [
  { uuid: "factory", id: 1, name: "JianYing" },
  { uuid: "custom", id: 1, name: "edited", _dirty: true },
  { uuid: "custom-2", id: 8, name: "other", _dirtySlots: [0] },
]});
equal(legacy.userPresets.length, 2, "only modified legacy presets become user presets");
equal(legacy.userPresets[0].originTemplateId, "JianYing Win", "factory origin is retained");
equal(legacy.userPresets[1].originTemplateId, null, "custom preset has no factory origin");
equal(legacy.userPresets[0].originTemplateVersion, L.TEMPLATE_VERSION, "migration does not force an update prompt");
const packaged = L.packageLibrary(legacy.userPresets);
equal(packaged.schemaVersion, 2, "packaged library schema");
equal(packaged.userPresets.length, 2, "packaged user preset count");

const preserved = custom;
equal(L.syncTemplates([preserved], [template], () => false), true, "declined replacement reports a persistable change");
equal(preserved.name, "mine", "declined replacement preserves custom name");
equal(preserved.accent, undefined, "declined replacement preserves custom content");
equal(preserved.originTemplateVersion, L.TEMPLATE_VERSION, "declined choice is remembered");
const replaced = { ...custom, originTemplateVersion: 0, accent: [1, 2, 3], _dirtySlots: [0, 18] };
equal(L.syncTemplates([replaced], [template], () => true), true, "accepted replacement reports a persistable change");
equal(replaced.accent.join(","), "0,170,170", "accepted replacement updates template content");
equal(replaced.uuid, "user-1", "accepted replacement preserves local UUID");
equal(replaced.id, 9, "accepted replacement preserves device presetId");
equal(replaced.name, "mine", "accepted replacement preserves custom name");
equal(replaced._dirty, true, "accepted replacement is marked as a local edit");
equal(replaced._readonly, false, "accepted replacement remains editable");
equal(replaced._dirtySlots.length, 0, "accepted replacement clears stale dirty slots");
equal(Object.hasOwn(replaced, "templateId"), false, "template-only identity does not leak into user presets");
const current = { ...custom, originTemplateVersion: L.TEMPLATE_VERSION };
equal(L.syncTemplates([current], [template], () => { throw new Error("must not prompt for current template"); }), false,
  "current template does not trigger a replacement prompt or save");
const valid = P.createEmptyPreset(12, "Valid");
valid.uuid = "valid";
equal(L.validateUserPresets([valid], P), undefined, "valid stored entry passes centralized validation");
equal(L.userPresetError(valid, P), null, "per-entry validation accepts a valid preset");
equal(L.userPresetError({ ...valid, name: "" }, P), "Preset name is empty", "per-entry validation reports without throwing");
throws(() => L.validateUserPresets([{ ...valid, uuid: "" }], P), "stored entry requires a local UUID");
throws(() => L.validateUserPresets([{ ...valid, _dirtySlots: [0, 22] }], P), "dirty slot range is validated centrally");
throws(() => L.validateUserPresets([{ ...valid, name: "中中中中中中中中" }], P), "invalid stored name is rejected centrally");

console.log(`\nAll ${passed} checks passed.`);
