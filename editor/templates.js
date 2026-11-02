// 官方模板装配：presets/*.json 信封校验与模板构建；浏览器挂到 NavioEditorTemplates，Node 用 require。
// 信封沿用 .navio.json 导出格式，官方文件额外要求 metadata.templateId（=文件名 slug）、
// metadata.order（展示顺序）与可选 description/author；单条损坏跳过并报告，不拖垮整库。
(function (root, factory) {
  const P = root.NavioEditorPreset || (typeof require !== "undefined" ? require("./preset.js") : null);
  const api = factory(P);
  root.NavioEditorTemplates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function (P) {
  "use strict";

  if (!P) throw new Error("NavioEditorTemplates requires NavioEditorPreset; load preset.js first");
  const SLUG = /^[a-z0-9][a-z0-9-]*$/;

  function envelopeIssue(json, fileName) {
    if (!json || typeof json !== "object") return "无法读取或不是合法 JSON";
    if (json.schemaVersion !== 1 || json.record !== 1 || !json.preset) return "不是 .navio.json 兼容信封";
    const meta = json.metadata || {};
    if (typeof meta.templateId !== "string" || !SLUG.test(meta.templateId)) return "metadata.templateId 必须是小写 slug";
    if (!Number.isInteger(meta.order)) return "metadata.order 必须是整数";
    if (meta.templateId !== fileName.replace(/\.json$/, "")) return `templateId(${meta.templateId}) 与文件名不一致`;
    // 官方模板的 platform 严格校验（用户导入文件才会静默归一）：拼错平台名必须暴露而不是被藏起来
    if (json.preset.platform !== undefined && !P.PLATFORMS.includes(json.preset.platform))
      return `preset.platform 非法：${json.preset.platform}`;
    const errors = P.presetErrors(json.preset);
    if (errors.length) return errors[0];
    return null;
  }
  function assembleTemplate(json) {
    // 只保留模板运行所需字段；description/author/order 留在 JSON 里供人读与 CI 校验，
    // 不进模板对象，避免随用户副本渗入 localStorage
    return { ...P.clonePresetData(json.preset), templateId: json.metadata.templateId, _readonly: true };
  }
  function buildTemplates(entries) {
    const templates = [], errors = [], slugs = new Set(), ids = new Set();
    for (const { file, json } of entries) {
      let issue = envelopeIssue(json, file);
      if (!issue && slugs.has(json.metadata.templateId)) issue = `templateId 重复：${json.metadata.templateId}`;
      if (!issue && ids.has(json.preset.id)) issue = `preset id 重复：${json.preset.id}`;
      if (issue) { errors.push(`${file}：${issue}`); continue; }
      slugs.add(json.metadata.templateId);
      ids.add(json.preset.id);
      templates.push({ order: json.metadata.order, templateId: json.metadata.templateId, template: assembleTemplate(json) });
    }
    templates.sort((a, b) => a.order - b.order || a.templateId.localeCompare(b.templateId));
    return { templates: templates.map(entry => entry.template), errors };
  }

  return { envelopeIssue, assembleTemplate, buildTemplates };
});
