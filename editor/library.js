// 官方模板与用户预设分离、迁移和版本同步；浏览器挂到 NavioEditorLibrary。
(function (root, factory) {
  const api = factory();
  root.NavioEditorLibrary = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const SCHEMA_VERSION = 2, TEMPLATE_VERSION = 1;
  const FACTORY_IDS = { 1: "jianying-win", 2: "resolve-win", 3: "test", 4: "f13-macro" };
  const clone = value => JSON.parse(JSON.stringify(value));

  function sourceKey(source, preset) {
    if (source === "template" && typeof preset?.templateId === "string") return `template:${preset.templateId}`;
    if (source === "device" && Number.isInteger(preset?.id)) return `device:${preset.id}`;
    return null;
  }
  function existingSourceCopy(userPresets, key) {
    return key ? userPresets.find(preset => preset._originSourceKey === key) || null : null;
  }
  function createUserCopy(source, Preset, identity) {
    const copy = Preset.clonePresetData(source);
    copy.uuid = identity.uuid;
    copy.id = identity.id;
    copy._readonly = false;
    copy._dirty = false;
    copy._dirtySlots = [];
    copy.originTemplateId = null;
    copy.originTemplateVersion = null;
    copy._originSourceKey = identity.originSourceKey || null;
    return copy;
  }

  function packageLibrary(userPresets) {
    return { schemaVersion: SCHEMA_VERSION, templateVersion: TEMPLATE_VERSION, userPresets };
  }
  function migrateLegacy(saved) {
    if (!saved) return packageLibrary([]);
    if (saved.schemaVersion === 1 && Array.isArray(saved.presets)) {
      const userPresets = saved.presets.filter(preset => preset._dirty || preset._dirtySlots?.length)
        .map(preset => ({ ...clone(preset), originTemplateId: FACTORY_IDS[preset.id] || null,
          originTemplateVersion: TEMPLATE_VERSION }));
      return packageLibrary(userPresets);
    }
    if (saved.schemaVersion !== SCHEMA_VERSION || !Array.isArray(saved.userPresets))
      throw new Error("本地预设库版本或格式不受支持");
    return {
      schemaVersion: SCHEMA_VERSION,
      templateVersion: saved.templateVersion || TEMPLATE_VERSION,
      userPresets: saved.userPresets.map(clone),
    };
  }
  function userPresetError(preset, Preset) {
    const errors = Preset.presetErrors(preset);
    if (typeof preset?.uuid !== 'string' || !preset.uuid) errors.push('Invalid local UUID');
    if (preset?._dirtySlots !== undefined && (!Array.isArray(preset._dirtySlots) ||
        preset._dirtySlots.some(slot => !Number.isInteger(slot) || slot < 0 || slot >= Preset.ACTION_COUNT)))
      errors.push('Invalid dirty slots');
    if (preset?._originSourceKey !== undefined && preset._originSourceKey !== null &&
        (typeof preset._originSourceKey !== 'string' || preset._originSourceKey.length > 160 ||
        !/^(template:[a-z0-9-]+|device:(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]))$/.test(preset._originSourceKey)))
      errors.push('Invalid origin source');
    return errors[0] || null;
  }
  function validateUserPresets(userPresets, Preset) {
    for (const preset of userPresets) {
      const issue = userPresetError(preset, Preset);
      if (issue) throw new Error(`本地预设“${preset?.name || preset?.uuid || '未命名'}”无效：${issue}`);
    }
  }
  function syncTemplates(userPresets, templates, confirmReplacement) {
    let changed = false;
    for (const preset of userPresets) {
      if (!preset.originTemplateId) continue;
      const template = templates.find(item => item.templateId === preset.originTemplateId);
      const sourceVersion = preset.originTemplateVersion || 0;
      if (!template || sourceVersion >= TEMPLATE_VERSION) continue;
      if (confirmReplacement(preset, template)) {
        const identity = { uuid: preset.uuid, id: preset.id, name: preset.name,
          originTemplateId: preset.originTemplateId };
        Object.assign(preset, clone(template), identity, { _readonly: false, _dirty: true, _dirtySlots: [] });
        delete preset.templateId;
      }
      preset.originTemplateVersion = TEMPLATE_VERSION;
      changed = true;
    }
    return changed;
  }

  return { SCHEMA_VERSION, TEMPLATE_VERSION, FACTORY_IDS, sourceKey, existingSourceCopy, createUserCopy,
    packageLibrary, migrateLegacy, userPresetError, validateUserPresets, syncTemplates };
});
