// Navio 预设模型与 150B 编解码；浏览器挂到 NavioEditorPreset，Node 用 require。
(function (root, factory) {
  const proto = root.NavioProto || (typeof require !== "undefined" ? require("../tools/probe/navio_proto.js") : null);
  const api = factory(proto);
  root.NavioEditorPreset = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function (Proto) {
  "use strict";

  if (!Proto) throw new Error("NavioEditorPreset requires NavioProto; load navio_proto.js first");
  const RECORD_SIZE = 150, ACTION_SIZE = 5, ACTION_COUNT = 22, SIDE_KEY_SLOT = 15;
  const Kind = { None: 0, KeyChord: 1, Consumer: 2, Wheel: 3 };
  const BUTTON_LABELS = [
    "K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8", "K9", "K10", "K11", "K12",
    "中央旋钮按压", "大旋钮按压", "滚轮下压", "SideKey",
  ];
  const ENCODERS = [
    { id: "Center", name: "中央旋钮", pressSlot: 12, cwSlot: 16, ccwSlot: 17 },
    { id: "Large", name: "大旋钮", pressSlot: 13, cwSlot: 18, ccwSlot: 19 },
    { id: "Wheel", name: "滚轮", pressSlot: 14, cwSlot: 20, ccwSlot: 21 },
  ];
  const KEY_OPTIONS = [];
  const key = (label, code) => KEY_OPTIONS.push({ label, code });
  for (let i = 0; i < 26; ++i) key(String.fromCharCode(65 + i), 0x04 + i);
  for (let i = 1; i <= 9; ++i) key(String(i), 0x1E + i - 1);
  key("0", 0x27);
  key("Enter", 0x28); key("Esc", 0x29); key("Backspace", 0x2A); key("Tab", 0x2B); key("Space", 0x2C);
  key("-", 0x2D); key("=", 0x2E); key("[", 0x2F); key("]", 0x30); key("\\", 0x31);
  key(";", 0x33); key("'", 0x34); key("`", 0x35); key(",", 0x36); key(".", 0x37); key("/", 0x38);
  for (let i = 1; i <= 12; ++i) key(`F${i}`, 0x3A + i - 1);
  for (let i = 13; i <= 24; ++i) key(`F${i}`, 0x68 + i - 13);
  key("Insert", 0x49); key("Home", 0x4A); key("Page Up", 0x4B); key("Delete", 0x4C);
  key("End", 0x4D); key("Page Down", 0x4E); key("→", 0x4F); key("←", 0x50); key("↓", 0x51); key("↑", 0x52);
  const CONSUMER_OPTIONS = [
    { label: "播放/暂停", code: 0x00CD }, { label: "停止", code: 0x00B7 },
    { label: "下一曲", code: 0x00B5 }, { label: "上一曲", code: 0x00B6 },
    { label: "静音", code: 0x00E2 }, { label: "音量+", code: 0x00E9 }, { label: "音量-", code: 0x00EA },
  ];
  const KEY_LABELS = Object.fromEntries([...KEY_OPTIONS, ...CONSUMER_OPTIONS].map(option => [option.code, option.label]));
  const MOD_LABELS = ["Ctrl", "Shift", "Alt", "Win", "RCtrl", "RShift", "RAlt", "RWin"];

  const { crc16, le16, u16 } = Proto;
  function emptyAction() { return { kind: Kind.None, mods: 0, code: 0, wheelDy: 0 }; }
  function actionForKind(kind, previous = null) {
    const action = emptyAction();
    action.kind = kind;
    if ((kind === Kind.KeyChord || kind === Kind.Wheel) && previous && Number.isInteger(previous.mods))
      action.mods = previous.mods;
    if (kind === Kind.KeyChord) action.code = 0x04;
    else if (kind === Kind.Consumer) action.code = 0xCD;
    else if (kind === Kind.Wheel) action.wheelDy = 1;
    return action;
  }
  function createEmptyPreset(id = 1, name = "自定义预设") {
    return { id, name, accent: [255, 120, 40], rgbMode: 0,
      actions: Array.from({ length: ACTION_COUNT }, emptyAction) };
  }
  function clonePreset(preset) { return JSON.parse(JSON.stringify(preset)); }
  function clonePresetData(preset) {
    const { id, name, accent, rgbMode, actions } = preset;
    return clonePreset({ id, name, accent, rgbMode, actions });
  }
  function utf8Length(value) { return new TextEncoder().encode(value).length; }
  function hasUnpairedSurrogate(value) {
    for (let i = 0; i < value.length; ++i) {
      const code = value.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        if (i + 1 >= value.length || value.charCodeAt(i + 1) < 0xDC00 || value.charCodeAt(i + 1) > 0xDFFF) return true;
        ++i;
      } else if (code >= 0xDC00 && code <= 0xDFFF) return true;
    }
    return false;
  }
  function nameError(name) {
    if (typeof name !== "string" || !name.length) return "Preset name is empty";
    if (name.includes("\0")) return "Preset name contains NUL";
    if (hasUnpairedSurrogate(name)) return "Preset name has an unpaired surrogate";
    if (utf8Length(name) > 23) return "Preset name exceeds 23 UTF-8 bytes";
    return null;
  }
  function actionError(action, button) {
    if (!action || !Object.values(Kind).includes(action.kind) ||
        !Number.isInteger(action.mods) || action.mods < 0 || action.mods > 255 ||
        !Number.isInteger(action.code) || action.code < 0 || action.code > 0xFFFF ||
        !Number.isInteger(action.wheelDy) || action.wheelDy < -128 || action.wheelDy > 127)
      return "Malformed action fields";
    if (action.kind === Kind.None)
      return action.mods === 0 && action.code === 0 && action.wheelDy === 0 ? null : "None requires zero fields";
    if (action.kind === Kind.KeyChord) {
      if (action.code > 0xE7 || action.wheelDy !== 0) return "Invalid KeyChord fields";
      if (action.code === 0 && action.mods === 0) return "Empty KeyChord must use None";
      return null;
    }
    if (action.kind === Kind.Consumer)
      return action.code >= 1 && action.code <= 0x03FF && action.mods === 0 && action.wheelDy === 0
        ? null : "Invalid Consumer fields";
    return !button && action.code === 0 && action.wheelDy !== 0 ? null : "Wheel is only valid on encoder slots";
  }
  function presetErrors(preset) {
    const errors = [];
    if (!preset || !Number.isInteger(preset.id) || preset.id < 1 || preset.id > 255) errors.push("Invalid preset ID");
    const nameIssue = preset ? nameError(preset.name) : "Missing preset";
    if (nameIssue) errors.push(nameIssue);
    if (!preset || !Array.isArray(preset.accent) || preset.accent.length !== 3 ||
        preset.accent.some(value => !Number.isInteger(value) || value < 0 || value > 255)) errors.push("Invalid accent");
    if (!preset || preset.rgbMode !== 0) errors.push("Unsupported rgbMode");
    if (!preset || !Array.isArray(preset.actions) || preset.actions.length !== ACTION_COUNT) {
      errors.push("Expected 22 actions");
      return errors;
    }
    preset.actions.forEach((action, index) => {
      const issue = actionError(action, index < 16);
      if (issue) errors.push(`Action ${index}: ${issue}`);
    });
    return errors;
  }
  function encodePresetRecord(preset) {
    const errors = presetErrors(preset);
    if (errors.length) throw new Error(errors[0]);
    const out = new Uint8Array(RECORD_SIZE);
    out.set([0x4E, 0x50, 1, 0, ...le16(RECORD_SIZE), preset.id, utf8Length(preset.name)], 0);
    out.set(preset.accent, 8);
    const name = new TextEncoder().encode(preset.name);
    out.set(name, 14);
    preset.actions.forEach((action, index) => {
      const offset = 38 + index * ACTION_SIZE;
      out[offset] = action.kind;
      out[offset + 1] = action.mods;
      out.set(le16(action.code), offset + 2);
      out[offset + 4] = action.wheelDy & 0xFF;
    });
    out.set(le16(crc16(out.subarray(0, 148))), 148);
    return out;
  }
  function decodePresetRecord(data) {
    if (!(data instanceof Uint8Array) || data.length !== RECORD_SIZE) throw new Error("Invalid preset record");
    if (data[2] !== 1) {
      const error = new Error("Unsupported preset record version");
      error.code = "UNSUPPORTED_VERSION";
      throw error;
    }
    if (data[0] !== 0x4E || data[1] !== 0x50 || data[3] !== 0 || u16(data, 4) !== RECORD_SIZE ||
        data[11] !== 0 || data[12] !== 0 || data[13] !== 0 || crc16(data.subarray(0, 148)) !== u16(data, 148))
      throw new Error("Invalid preset record header or CRC");
    const nameLength = data[7];
    if (!nameLength || nameLength > 23) throw new Error("Invalid preset name length");
    for (let i = 14 + nameLength; i < 38; ++i) if (data[i] !== 0) throw new Error("Invalid preset name padding");
    const preset = { id: data[6], name: new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(14, 14 + nameLength)),
      accent: Array.from(data.subarray(8, 11)), rgbMode: 0, actions: [] };
    for (let index = 0; index < ACTION_COUNT; ++index) {
      const offset = 38 + index * ACTION_SIZE;
      preset.actions.push({ kind: data[offset], mods: data[offset + 1], code: u16(data, offset + 2),
        wheelDy: data[offset + 4] << 24 >> 24 });
    }
    const errors = presetErrors(preset);
    if (errors.length) throw new Error(errors[0]);
    return preset;
  }
  function actionLabel(action) {
    if (!action || action.kind === Kind.None) return "未设置";
    const mods = MOD_LABELS.filter((_, bit) => action.mods & (1 << bit));
    if (action.kind === Kind.KeyChord && action.code === 0) return mods.join("+");
    const code = action.kind === Kind.Wheel ? `滚轮${action.wheelDy > 0 ? "+" : ""}${action.wheelDy}` :
      KEY_LABELS[action.code] || `0x${action.code.toString(16).padStart(2, "0")}`;
    return [...mods, code].join("+");
  }

  return { RECORD_SIZE, ACTION_SIZE, ACTION_COUNT, SIDE_KEY_SLOT, Kind, BUTTON_LABELS, ENCODERS,
    KEY_OPTIONS, CONSUMER_OPTIONS, MOD_LABELS, crc16, emptyAction, actionForKind, createEmptyPreset, clonePreset, clonePresetData,
    utf8Length, nameError, actionError, presetErrors, encodePresetRecord, decodePresetRecord, actionLabel };
});
