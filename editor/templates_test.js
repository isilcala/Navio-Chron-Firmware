// 运行：node editor/templates_test.js
// 校验 editor/presets/ 官方模板库：信封与预设合法性、150B 往返、slug/ID 唯一、index.json 无漂移、
// 以及与固件出厂预设（src/mapping/Presets.cpp）的逐槽基线（2026-11-02 K10/K11 事故后固化）。
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const P = require("./preset.js");
const T = require("./templates.js");
let passed = 0;
function ok(name) { passed++; console.log("PASS", name); }
function assert(cond, msg) { if (!cond) throw new Error(`assert: ${msg}`); }
function equal(actual, expected, name) { assert(Object.is(actual, expected), `${name}: ${actual} != ${expected}`); ok(name); }

const dir = path.join(__dirname, "presets");
const files = fs.readdirSync(dir).filter(file => file.endsWith(".json") && file !== "index.json").sort();
const readJson = file => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
const entries = files.map(file => ({ file, json: readJson(file) }));

// --- 模块单元：合成坏例逐条隔离，不拖垮整库 ---
// templateId 必须与文件名一致，所以信封工厂以文件名生成 templateId；
// 重复 templateId 在文件名检查处必然先被拦截，无需单独用例。
const env = (file, order, presetId = 90) => {
  const preset = P.createEmptyPreset(presetId, "合成");
  return { schemaVersion: 1, product: "navio-chron", record: 1,
    metadata: { author: "test", templateId: file.replace(/\.json$/, ""), order }, preset };
};
const built = T.buildTemplates([
  { file: "synthetic.json", json: env("synthetic.json", 1) },
  { file: "broken.json", json: null },
  { file: "bad-slug.json", json: { ...env("bad-slug.json", 2), metadata: { ...env("bad-slug.json", 2).metadata, templateId: "Synthetic" } } },
]);
equal(built.templates.length, 1, "valid entries assemble while invalid ones are skipped");
equal(built.errors.length, 2, "each invalid entry reports one error");
equal(built.templates[0]._readonly, true, "assembled templates are readonly");
equal(built.templates[0].templateId, "synthetic", "templateId comes from metadata");
assert(!Object.hasOwn(built.templates[0], "description"), "metadata extras stay out of the template object");
const dupId = T.buildTemplates([
  { file: "a.json", json: env("a.json", 1, 91) },
  { file: "b.json", json: env("b.json", 2, 91) },
]);
equal(dupId.errors.length, 1, "duplicate preset id is rejected");
const badPlatform = env("x.json", 1);
badPlatform.preset.platform = "andriod";
equal(T.buildTemplates([{ file: "x.json", json: badPlatform }]).errors.length, 1,
  "misspelled raw platform is rejected, not silently normalized");
equal(T.envelopeIssue({ ...env("synthetic.json", 1), metadata: { templateId: "synthetic" } }, "synthetic.json") !== null, true,
  "missing order is rejected");
equal(T.envelopeIssue(env("synthetic.json", 1), "other.json") !== null, true,
  "templateId must match the file name");
const ordered = T.buildTemplates([
  { file: "z.json", json: env("z.json", 9, 92) },
  { file: "a.json", json: env("a.json", 2, 91) },
]);
equal(ordered.templates[0].templateId, "a", "templates sort by metadata.order");

// --- 真实目录：逐文件合法 + 150B 往返 ---
for (const { file, json } of entries) {
  equal(T.envelopeIssue(json, file), null, `envelope valid: ${file}`);
  const record = P.encodePresetRecord(json.preset);
  const decoded = P.decodePresetRecord(record);
  equal(decoded.name, json.preset.name, `150B round trip name: ${file}`);
  assert(JSON.stringify(decoded.actions) === JSON.stringify(json.preset.actions), `150B round trip actions: ${file}`);
  ok(`150B round trip actions: ${file}`);
}

// --- 装配：真实文件全量 ---
const loaded = T.buildTemplates(entries);
equal(loaded.errors.length, 0, `all ${files.length} official templates assemble without errors`);
// 数量下限守卫防误删；目录/索引不一致的精确拦截由下方漂移检查负责（报错带修复指引）
assert(loaded.templates.length >= 28, "official library shrank below 28 templates — intentional?");
ok("official library holds at least 28 templates");
const orders = loaded.templates.map(t => t.templateId);
equal(orders[0], "jianying-win", "display order starts with jianying-win");
equal(orders.includes("procreate"), true, "procreate template present");
const expandedApps = ["capcut-win", "capcut-mac", "final-cut-pro", "after-effects-win", "after-effects-mac",
  "blender-win", "blender-mac", "illustrator-win", "illustrator-mac",
  "photoshop-win", "photoshop-mac", "lightroom-classic-win", "lightroom-classic-mac", "capture-one-win", "capture-one-mac",
  "clip-studio-paint-win", "clip-studio-paint-mac", "krita-win", "krita-mac"];
for (const slug of expandedApps)
  assert(orders.includes(slug), `expanded official template missing: ${slug}`);
ok("all 19 expanded app templates present");
equal(orders.at(-2), "f13-macro", "utility templates follow app templates");
equal(orders.at(-1), "test", "test template is last");
for (const slug of ["jianying", "capcut", "resolve", "premiere", "after-effects", "blender", "illustrator", "photoshop", "lightroom-classic", "capture-one", "clip-studio-paint", "krita"]) {
  const win = loaded.templates.find(t => t.templateId === `${slug}-win`);
  const mac = loaded.templates.find(t => t.templateId === `${slug}-mac`);
  assert(win && mac, `platform pair exists: ${slug}`);
  equal(win.accent.join(","), mac.accent.join(","), `platform pair shares brand accent: ${slug}`);
}
equal(loaded.templates.find(t => t.templateId === "test").accent.join(","), "255,255,255", "Test template uses pure white accent");
const firmwareSource = fs.readFileSync(path.join(__dirname, "../src/mapping/Presets.cpp"), "utf8");
assert(/kPresetTest\s*=\s*\{\s*"Test",\s*\{255,\s*255,\s*255\}/.test(firmwareSource), "firmware Test preset uses pure white accent");
ok("firmware Test preset uses pure white accent");
const slugs = new Set(loaded.templates.map(t => t.templateId));
equal(slugs.size, loaded.templates.length, "templateId unique across the library");

// --- index.json 漂移检查：与目录再生成结果一致 ---
const expectedIndex = {
  version: 1,
  templates: entries.map(({ file, json }) => ({ file, templateId: json.metadata.templateId, order: json.metadata.order }))
    .sort((a, b) => a.order - b.order || a.templateId.localeCompare(b.templateId)),
};
equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"))),
  JSON.stringify(expectedIndex), "index.json matches the presets directory (run tools/build_templates.js)");

// --- 固件基线：与 src/mapping/Presets.cpp 逐槽比对（2026-10-26 实测回填 + 实战通过） ---
const k = (mods, code) => ({ kind: P.Kind.KeyChord, mods, code, wheelDy: 0 });
const w = (mods, dy) => ({ kind: P.Kind.Wheel, mods, code: 0, wheelDy: dy });
const c = code => ({ kind: P.Kind.Consumer, mods: 0, code, wheelDy: 0 });
const firmware = {
  "jianying-win": { 0: k(0, 0x14), 1: k(1, 0x05), 2: k(0, 0x1A), 3: k(1, 0x1D), 4: k(3, 0x1D), 5: k(0, 0x2C), 6: k(0, 0x2A), 7: k(0, 0x52), 8: k(4, 0), 9: k(0, 0x50), 10: k(0, 0x51), 11: k(0, 0x4F), 12: k(0, 0x19), 13: k(0, 0x2C), 14: k(0, 0x27), 16: k(0, 0x4F), 17: k(0, 0x50), 18: w(4, 1), 19: w(4, -1), 20: w(1, 1), 21: w(1, -1) },
  "resolve-win": { 0: k(0, 0x0C), 1: k(1, 0x31), 2: k(0, 0x12), 3: k(1, 0x1D), 4: k(1, 0x1C), 5: k(0, 0x2C), 6: k(2, 0x2A), 7: k(0, 0x52), 8: k(0, 0x10), 9: k(0, 0x50), 10: k(0, 0x51), 11: k(0, 0x4F), 12: k(0, 0x43), 13: k(0, 0x0E), 14: k(0, 0x2C), 16: k(0, 0x4F), 17: k(0, 0x50), 18: k(0, 0x0F), 19: k(0, 0x0D), 20: k(1, 0x2E), 21: k(1, 0x2D) },
  "test": { 0: k(0, 0x1E), 8: k(0, 0x26), 9: k(0, 0x27), 10: k(0, 0x2D), 11: k(0, 0x2E), 12: c(0xE2), 13: k(0, 0x28), 14: k(0, 0x29), 16: c(0xE9), 17: c(0xEA), 18: k(0, 0x4F), 19: k(0, 0x50), 20: w(0, 1), 21: w(0, -1) },
  "f13-macro": { 0: k(0, 0x68), 9: k(0, 0x71), 11: k(0, 0x73), 12: c(0xCD), 13: k(0, 0x2C), 14: k(1, 0x1D), 16: c(0xE9), 17: c(0xEA), 18: k(1, 0x2E), 19: k(1, 0x2D), 20: w(0, 1), 21: w(0, -1) },
};
for (const [slug, expect] of Object.entries(firmware)) {
  const template = loaded.templates.find(t => t.templateId === slug);
  assert(template, `firmware baseline template missing: ${slug}`);
  for (const [slot, action] of Object.entries(expect))
    assert(JSON.stringify(template.actions[+slot]) === JSON.stringify(action),
      `firmware baseline ${slug} slot ${slot}`);
  ok(`firmware baseline slot-identical: ${slug}`);
}
// 第二批关键槽位：视图控制、画笔属性与容易混淆的主键盘数字键
const secondBatch = {
  "blender-win": { 16: k(0, 0x5E), 17: k(0, 0x5C), 20: k(0, 0x57), 21: k(0, 0x56) },
  "blender-mac": { 16: k(0, 0x5E), 17: k(0, 0x5C), 20: k(0, 0x57), 21: k(0, 0x56) },
  "illustrator-win": { 13: k(1, 0x27), 14: k(1, 0x1E), 18: k(5, 0x30) },
  "illustrator-mac": { 13: k(8, 0x27), 14: k(8, 0x1E), 18: k(12, 0x30) },
  "capture-one-win": { 16: k(0, 0x30), 18: k(2, 0x30), 20: k(1, 0x2E) },
  "capture-one-mac": { 16: k(0, 0x30), 18: k(2, 0x30), 20: k(8, 0x2E) },
  "krita-win": { 6: k(0, 0x49), 13: k(0, 0x22), 14: k(0, 0x1F) },
  "krita-mac": { 6: k(0, 0x49), 13: k(0, 0x22), 14: k(0, 0x1F) },
};
for (const [slug, expect] of Object.entries(secondBatch)) {
  const template = loaded.templates.find(t => t.templateId === slug);
  assert(template, `second-batch baseline template missing: ${slug}`);
  for (const [slot, action] of Object.entries(expect))
    assert(JSON.stringify(template.actions[+slot]) === JSON.stringify(action),
      `second-batch baseline ${slug} slot ${slot}`);
  ok(`second-batch baseline slot-identical: ${slug}`);
}
// 平台变体与箭头簇抽查（K10=← K11=↓ K12=→，硬件笔记 2026-10-26 实测）
for (const template of loaded.templates) {
  const { actions } = template;
  if (template.templateId === "test" || template.templateId === "f13-macro") continue;
  assert(actions[9].code === 0x50 && actions[10].code === 0x51 && actions[11].code === 0x4F,
    `arrow cluster of ${template.templateId}`);
}
ok("arrow cluster K10/K11/K12 consistent across app templates");
// 显示名不得内嵌平台词：平台由 chip 呈现，名称只留应用名
for (const template of loaded.templates)
  assert(!/ (Win|Mac|iPad)$/.test(template.name), `name embeds platform: ${template.name}`);
ok("template names do not embed platform labels");

console.log(`\nAll ${passed} checks passed.`);
