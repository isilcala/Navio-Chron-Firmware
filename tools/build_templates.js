// 生成 editor/presets/index.json：浏览器不能列目录，项目模板索引在构建期生成并提交入库。
// 贡献流程：在编辑器里导出 .navio.json → 放入 editor/presets/（补 metadata.templateId/order）→ 运行本脚本 → 提 PR。
// 运行：node tools/build_templates.js
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "..", "editor", "presets");
const files = fs.readdirSync(dir).filter(file => file.endsWith(".json") && file !== "index.json");
const templates = files.map(file => {
  const json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  const meta = json.metadata || {};
  if (typeof meta.templateId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(meta.templateId))
    throw new Error(`${file}: metadata.templateId 缺失或不是小写 slug`);
  if (!Number.isInteger(meta.order)) throw new Error(`${file}: metadata.order 必须是整数`);
  if (meta.templateId !== file.replace(/\.json$/, ""))
    throw new Error(`${file}: metadata.templateId(${meta.templateId}) 必须与文件名一致`);
  return { file, templateId: meta.templateId, order: meta.order };
}).sort((a, b) => a.order - b.order || a.templateId.localeCompare(b.templateId));

const index = { version: 1, templates };
fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`index.json 已生成：${templates.length} 套项目模板`);
