// 运行：node editor/template_browser_test.js
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const T = require("./templates.js");
const B = require("./template_browser.js");
let passed = 0;
function ok(name) { passed++; console.log("PASS", name); }
function assert(cond, msg) { if (!cond) throw new Error(`assert: ${msg}`); }
function equal(actual, expected, name) { assert(Object.is(actual, expected), `${name}: ${actual} != ${expected}`); ok(name); }

const dir = path.join(__dirname, "presets");
const entries = fs.readdirSync(dir).filter(file => file.endsWith(".json") && file !== "index.json")
  .map(file => ({ file, json: JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) }));
const templates = T.buildTemplates(entries).templates;
const groups = B.buildTemplateGroups(templates);
equal(B.countTemplateItems(groups), 18, "32 platform variants collapse to 18 application entries");
equal(groups.map(group => group.label).join("|"), "视频剪辑|动效 / 3D|矢量 / 修图|数字绘画|工具", "workflow groups follow curated order");
equal(groups[0].items.map(item => item.family).join("|"), "jianying|capcut|resolve|premiere|final-cut-pro|wondershare-filmora|bijian", "video applications keep curated order");
const photoshop = B.findTemplateItem(groups, "photoshop-win");
equal(photoshop.variants.length, 2, "Photoshop entry contains both platform variants");
equal(B.variantForPlatform(photoshop, "mac").templateId, "photoshop-mac", "preferred macOS variant selected");
equal(B.variantForPlatform(photoshop, "ipad").templateId, "photoshop-win", "unsupported platform falls back to first variant");
equal(B.findTemplateItem(groups, "final-cut-pro").variants[0].platform, "mac", "single-platform Final Cut entry retained");
equal(B.findTemplateItem(groups, "procreate").variants[0].platform, "ipad", "single-platform Procreate entry retained");
equal(B.countTemplateItems(B.filterTemplateGroups(groups, "ps")), 1, "common Photoshop alias matches");
equal(B.filterTemplateGroups(groups, "ps").groups, undefined, "filter result has no accidental groups property");
equal(B.filterTemplateGroups(groups, "ps")[0].items[0], photoshop, "search returns the original application entry");
equal(B.countTemplateItems(B.filterTemplateGroups(groups, "剪映")), 2, "Chinese aliases match JianYing and CapCut");
equal(B.countTemplateItems(B.filterTemplateGroups(groups, "filmora")), 1, "Filmora alias matches WanXing");
equal(B.countTemplateItems(B.filterTemplateGroups(groups, "哔哩哔哩")), 1, "Bilibili alias matches Bijian");
equal(B.countTemplateItems(B.filterTemplateGroups(groups, "photo mac")), 1, "multiple search terms combine with AND");
equal(B.countTemplateItems(B.filterTemplateGroups(groups, "macos")), 15, "platform search finds all macOS variants");
equal(B.countTemplateItems(B.filterTemplateGroups(groups, "ipad")), 1, "platform search finds iPad variant");
equal(B.countTemplateItems(B.filterTemplateGroups(groups, "绘画")), 3, "workflow label is searchable");
equal(B.filterTemplateGroups(groups, "not-an-application").length, 0, "no-match search returns empty groups");
equal(B.filterTemplateGroups(groups, "  "), groups, "blank search preserves grouped view");

const synthetic = B.buildTemplateGroups([{ name: "Future App", templateId: "future-app-win", platform: "win" }]);
equal(synthetic[0].label, "其他", "unknown future family has a safe fallback group");

console.log(`\nAll ${passed} checks passed.`);
