// 官方模板与用户预设分离、迁移和版本同步；浏览器挂到 NavioEditorLibrary。
(function (root, factory) {
  const api = factory();
  root.NavioEditorLibrary = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const SCHEMA_VERSION = 2, TEMPLATE_VERSION = 1;
  const FACTORY_IDS = { 1: "JianYing", 2: "Resolve", 3: "Test", 4: "F13 Macro" };
  const clone = value => JSON.parse(JSON.stringify(value));

  function packageLibrary(userPresets) {
    return { schemaVersion: SCHEMA_VERSION, templateVersion: TEMPLATE_VERSION, userPresets };
  }
  function migrateLegacy(saved) {
    if (!saved || saved.schemaVersion !== 2 || !Array.isArray(saved.userPresets)) {
      if (!saved || saved.schemaVersion !== 1 || !Array.isArray(saved.presets)) return packageLibrary([]);
      const userPresets = saved.presets.filter(preset => preset._dirty || preset._dirtySlots?.length)
        .map(preset => ({ ...clone(preset), originTemplateId: FACTORY_IDS[preset.id] || null,
          originTemplateVersion: TEMPLATE_VERSION }));
      return packageLibrary(userPresets);
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      templateVersion: saved.templateVersion || TEMPLATE_VERSION,
      userPresets: saved.userPresets.map(clone),
    };
  }
  function syncTemplates(userPresets, templates, confirmReplacement) {
    for (const preset of userPresets) {
      if (!preset.originTemplateId) continue;
      const template = templates.find(item => item.name === preset.originTemplateId);
      const sourceVersion = preset.originTemplateVersion || 0;
      if (!template || sourceVersion >= TEMPLATE_VERSION) continue;
      if (confirmReplacement(preset, template)) {
        const identity = { uuid: preset.uuid, id: preset.id, name: preset.name,
          originTemplateId: preset.originTemplateId };
        Object.assign(preset, clone(template), identity, { _dirty: true });
      }
      preset.originTemplateVersion = TEMPLATE_VERSION;
    }
  }

  return { SCHEMA_VERSION, TEMPLATE_VERSION, FACTORY_IDS, packageLibrary, migrateLegacy, syncTemplates };
});
