// 单套预设的 JSON 文本与 .navio.json 文件共用序列化/解析；浏览器和 Node 共用同一实现。
(function (root, factory) {
  const P = root.NavioEditorPreset || (typeof require !== "undefined" ? require("./preset.js") : null);
  const api = factory(P);
  root.NavioEditorImportExport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function (P) {
  "use strict";

  if (!P) throw new Error("NavioEditorImportExport requires NavioEditorPreset; load preset.js first");
  const MAX_IMPORT_BYTES = 65536;

  function serializePreset(preset) {
    const data = P.clonePresetData(preset);
    const errors = P.presetErrors(data);
    if (errors.length) throw new Error(`预设内容无效：${errors[0]}`);
    return JSON.stringify({
      schemaVersion: 1,
      product: "navio-chron",
      record: 1,
      metadata: { author: "local" },
      preset: data,
    }, null, 2) + "\n";
  }

  function parsePreset(text) {
    if (typeof text !== "string") throw new Error("请粘贴 JSON 文本或选择预设文件");
    if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error("预设文件过大；这里只支持单套预设");
    const source = text.replace(/^\uFEFF/, "").trim();
    if (!source) throw new Error("内容为空，请粘贴 JSON 或选择预设文件");
    let content;
    try { content = JSON.parse(source); }
    catch (error) { throw new Error(`JSON 语法错误：${error.message}`); }
    if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("根节点必须是单套预设对象");
    if (content.schemaVersion !== 1 || content.product !== "navio-chron" || content.record !== 1 || !content.preset)
      throw new Error("不支持的 .navio.json 格式、产品或 record 版本");
    if (typeof content.preset !== "object" || Array.isArray(content.preset)) throw new Error("缺少有效的 preset 对象");
    if (content.preset.platform !== undefined && !P.PLATFORMS.includes(content.preset.platform))
      throw new Error(`不支持的平台：${content.preset.platform}`);
    const errors = P.presetErrors(content.preset);
    if (errors.length) throw new Error(`预设内容无效：${errors[0]}`);
    return P.clonePresetData(content.preset);
  }

  return { MAX_IMPORT_BYTES, serializePreset, parsePreset };
});
