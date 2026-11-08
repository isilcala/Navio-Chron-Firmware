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
  const KEY_GROUPS = [
    { id: "letters", label: "字母" }, { id: "digits", label: "主键盘数字" },
    { id: "symbols", label: "主键盘符号" }, { id: "editing", label: "控制与编辑" },
    { id: "navigation", label: "导航" }, { id: "function", label: "功能键" },
    { id: "keypad", label: "小键盘" },
  ];
  const KEY_OPTIONS = [];
  const key = (group, label, code, optionLabel = label) => KEY_OPTIONS.push({ group, label, code, optionLabel });
  for (let i = 0; i < 26; ++i) key("letters", String.fromCharCode(65 + i), 0x04 + i);
  for (let i = 1; i <= 9; ++i) key("digits", String(i), 0x1E + i - 1);
  key("digits", "0", 0x27);
  key("symbols", "-", 0x2D); key("symbols", "=", 0x2E); key("symbols", "[", 0x2F);
  key("symbols", "]", 0x30); key("symbols", "\\", 0x31); key("symbols", ";", 0x33);
  key("symbols", "'", 0x34); key("symbols", "`", 0x35); key("symbols", ",", 0x36);
  key("symbols", ".", 0x37); key("symbols", "/", 0x38);
  key("editing", "Enter", 0x28); key("editing", "Esc", 0x29); key("editing", "Backspace", 0x2A);
  key("editing", "Tab", 0x2B); key("editing", "Space", 0x2C); key("editing", "Caps Lock", 0x39);
  key("editing", "Print Screen", 0x46); key("editing", "Scroll Lock", 0x47);
  key("editing", "Pause", 0x48); key("editing", "Menu", 0x65);
  key("navigation", "Insert", 0x49); key("navigation", "Home", 0x4A); key("navigation", "Page Up", 0x4B);
  key("navigation", "Delete", 0x4C); key("navigation", "End", 0x4D); key("navigation", "Page Down", 0x4E);
  key("navigation", "→", 0x4F); key("navigation", "←", 0x50);
  key("navigation", "↓", 0x51); key("navigation", "↑", 0x52);
  for (let i = 1; i <= 12; ++i) key("function", `F${i}`, 0x3A + i - 1);
  for (let i = 13; i <= 24; ++i) key("function", `F${i}`, 0x68 + i - 13);
  for (let i = 1; i <= 9; ++i) key("keypad", `小键盘 ${i}`, 0x59 + i - 1, String(i));
  key("keypad", "小键盘 0", 0x62, "0");
  key("keypad", "小键盘 +", 0x57, "+"); key("keypad", "小键盘 -", 0x56, "-");
  key("keypad", "小键盘 *", 0x55, "*"); key("keypad", "小键盘 /", 0x54, "/");
  key("keypad", "小键盘 .", 0x63, "."); key("keypad", "小键盘 Enter", 0x58, "Enter");
  key("keypad", "Num Lock / Clear", 0x53);
  const CONSUMER_OPTIONS = [
    { label: "播放/暂停", code: 0x00CD }, { label: "停止", code: 0x00B7 },
    { label: "下一曲", code: 0x00B5 }, { label: "上一曲", code: 0x00B6 },
    { label: "静音", code: 0x00E2 }, { label: "音量+", code: 0x00E9 }, { label: "音量-", code: 0x00EA },
  ];
  const KEY_LABELS = Object.fromEntries([...KEY_OPTIONS, ...CONSUMER_OPTIONS].map(option => [option.code, option.label]));
  const MOD_LABELS = ["Ctrl", "Shift", "Alt", "Win", "RCtrl", "RShift", "RAlt", "RWin"];
  // 同一物理修饰键位的平台文案：macOS/iPadOS 上左 GUI=Cmd、Alt=Option；ipad 与 mac 共用一套
  const MOD_LABELS_MAC = ["Ctrl", "Shift", "Opt", "Cmd", "RCtrl", "RShift", "ROpt", "RCmd"];
  const PLATFORMS = ["win", "mac", "ipad"];
  const RGB_MODES = [
    { value: 0, id: "off", label: "关闭灯效", description: "关闭全部按键灯，状态灯保持原有功能", detail: "关闭全部按键灯，状态灯保持原功能" },
    { value: 1, id: "reactive", label: "按键响应", description: "按下保持亮起，松开后渐隐；无输入时按键灯熄灭", detail: "按住保持主题色，松开后 500ms 渐隐" },
    { value: 2, id: "reactiveRandom", label: "随机按键响应", description: "每键独立随机颜色，按住保持、松开渐隐", detail: "每键独立随机色，松开渐隐" },
    { value: 3, id: "follow", label: "常亮", description: "全部按键灯持续显示主题色", detail: "全部按键持续显示主题色" },
    { value: 4, id: "breath", label: "柔和呼吸", description: "全部按键灯跟随主题色缓慢呼吸", detail: "9 秒柔和呼吸周期" },
    { value: 5, id: "breathRandom", label: "随机呼吸", description: "每轮呼吸使用新的随机颜色，不使用主题色", detail: "每 9 秒一轮随机色呼吸" },
    { value: 6, id: "colorCycle", label: "循环变色", description: "全部按键同步平滑循环 RGB 色相，不使用主题色", detail: "16 秒同步色相周期" },
    { value: 7, id: "rainbowFlow", label: "彩虹流动", description: "彩虹沿键盘外缘流动，不使用主题色", detail: "16 秒外缘流动周期" },
    { value: 8, id: "marquee", label: "主题走马灯", description: "主题色亮斑带拖尾，沿键盘外缘顺时针流动", detail: "14.4 秒外缘循环，亮头带三颗拖尾" },
    { value: 9, id: "rainbowMarquee", label: "彩虹走马灯", description: "亮斑与拖尾持续变换颜色，沿键盘外缘顺时针流动", detail: "14.4 秒外缘循环，16 秒色相周期" },
  ];
  // 150B 记录 byte 13 的平台码（D23）：0 是历史记录的天然值（旧数据零迁移）
  const PLATFORM_CODES = { win: 0, mac: 1, ipad: 2 };
  const PLATFORM_BY_CODE = ["win", "mac", "ipad"];
  const normalizePlatform = value => PLATFORMS.includes(value) ? value : "win";
  const modLabels = platform => normalizePlatform(platform) === "win" ? MOD_LABELS : MOD_LABELS_MAC;

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
    return {
      id, name, accent: [255, 120, 40], rgbMode: 1, platform: "win",
      actions: Array.from({ length: ACTION_COUNT }, emptyAction)
    };
  }
  function clonePreset(preset) { return JSON.parse(JSON.stringify(preset)); }
  function clonePresetData(preset) {
    const { id, name, accent, rgbMode, actions } = preset;
    // platform 同时随记录 byte 13 与导出/副本携带；固件只存取，不据此分支
    return clonePreset({ id, name, accent, rgbMode, platform: normalizePlatform(preset.platform), actions });
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
    if (!preset || !RGB_MODES.some(mode => mode.value === preset.rgbMode)) errors.push("Unsupported rgbMode");
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
    out[11] = preset.rgbMode;
    out[13] = PLATFORM_CODES[normalizePlatform(preset.platform)];
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
      data[11] >= RGB_MODES.length || data[12] !== 0 || data[13] > 2 ||
      crc16(data.subarray(0, 148)) !== u16(data, 148))
      throw new Error("Invalid preset record header or CRC");
    const nameLength = data[7];
    if (!nameLength || nameLength > 23) throw new Error("Invalid preset name length");
    for (let i = 14 + nameLength; i < 38; ++i) if (data[i] !== 0) throw new Error("Invalid preset name padding");
    const preset = {
      id: data[6], name: new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(14, 14 + nameLength)),
      accent: Array.from(data.subarray(8, 11)), rgbMode: data[11], platform: PLATFORM_BY_CODE[data[13]], actions: []
    };
    for (let index = 0; index < ACTION_COUNT; ++index) {
      const offset = 38 + index * ACTION_SIZE;
      preset.actions.push({
        kind: data[offset], mods: data[offset + 1], code: u16(data, offset + 2),
        wheelDy: data[offset + 4] << 24 >> 24
      });
    }
    const errors = presetErrors(preset);
    if (errors.length) throw new Error(errors[0]);
    return preset;
  }
  function actionLabel(action, platform = "win") {
    if (!action || action.kind === Kind.None) return "未设置";
    const mods = modLabels(platform).filter((_, bit) => action.mods & (1 << bit));
    if (action.kind === Kind.KeyChord && action.code === 0) return mods.join("+");
    const code = action.kind === Kind.Wheel ? `滚轮${action.wheelDy > 0 ? "+" : ""}${action.wheelDy}` :
      KEY_LABELS[action.code] || `0x${action.code.toString(16).padStart(2, "0")}`;
    return [...mods, code].join("+");
  }

  return {
    RECORD_SIZE, ACTION_SIZE, ACTION_COUNT, SIDE_KEY_SLOT, Kind, BUTTON_LABELS, ENCODERS,
    KEY_GROUPS, KEY_OPTIONS, CONSUMER_OPTIONS, MOD_LABELS, MOD_LABELS_MAC, PLATFORMS, RGB_MODES, PLATFORM_CODES, normalizePlatform, modLabels,
    crc16, emptyAction, actionForKind, createEmptyPreset, clonePreset, clonePresetData,
    utf8Length, nameError, actionError, presetErrors, encodePresetRecord, decodePresetRecord, actionLabel
  };
});
