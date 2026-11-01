// 运行：node editor/library_test.js
"use strict";
const L = require("./library.js");
let passed = 0;
function ok(name) { passed++; console.log("PASS", name); }
function assert(cond, msg) { if (!cond) throw new Error(`assert: ${msg}`); }
function equal(actual, expected, name) { assert(Object.is(actual, expected), `${name}: ${actual} != ${expected}`); ok(name); }
const template = { name: "JianYing", accent: [0, 170, 170], actions: [] };
const custom = { uuid: "user-1", id: 9, name: "mine", originTemplateId: "JianYing", originTemplateVersion: 0, actions: [] };

equal(L.SCHEMA_VERSION, 2, "library schema is version 2");
equal(L.migrateLegacy(null).userPresets.length, 0, "empty storage starts with no user presets");
const legacy = L.migrateLegacy({ schemaVersion: 1, presets: [
  { uuid: "factory", id: 1, name: "JianYing" },
  { uuid: "custom", id: 1, name: "edited", _dirty: true },
  { uuid: "custom-2", id: 8, name: "other", _dirtySlots: [0] },
]});
equal(legacy.userPresets.length, 2, "only modified legacy presets become user presets");
equal(legacy.userPresets[0].originTemplateId, "JianYing", "factory origin is retained");
equal(legacy.userPresets[1].originTemplateId, null, "custom preset has no factory origin");
equal(legacy.userPresets[0].originTemplateVersion, L.TEMPLATE_VERSION, "migration does not force an update prompt");
const packaged = L.packageLibrary(legacy.userPresets);
equal(packaged.schemaVersion, 2, "packaged library schema");
equal(packaged.userPresets.length, 2, "packaged user preset count");

const preserved = custom;
L.syncTemplates([preserved], [template], () => false);
equal(preserved.name, "mine", "declined replacement preserves custom name");
equal(preserved.accent, undefined, "declined replacement preserves custom content");
equal(preserved.originTemplateVersion, L.TEMPLATE_VERSION, "declined choice is remembered");
const replaced = { ...custom, originTemplateVersion: 0, accent: [1, 2, 3] };
L.syncTemplates([replaced], [template], () => true);
equal(replaced.accent.join(","), "0,170,170", "accepted replacement updates template content");
equal(replaced.uuid, "user-1", "accepted replacement preserves local UUID");
equal(replaced.id, 9, "accepted replacement preserves device presetId");
equal(replaced.name, "mine", "accepted replacement preserves custom name");
equal(replaced._dirty, true, "accepted replacement is marked as a local edit");
const current = { ...custom, originTemplateVersion: L.TEMPLATE_VERSION };
L.syncTemplates([current], [template], () => { throw new Error("must not prompt for current template"); });
ok("current template does not trigger a replacement prompt");

console.log(`\nAll ${passed} checks passed.`);
