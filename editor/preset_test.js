// 运行：node editor/preset_test.js
"use strict";
const P = require("./preset.js");
const Proto = require("../tools/probe/navio_proto.js");
const fs = require("node:fs");
const vm = require("node:vm");
let passed = 0;
function ok(name) { passed++; console.log("PASS", name); }
function assert(cond, msg) { if (!cond) throw new Error(`assert: ${msg}`); }
function equal(actual, expected, name) { assert(Object.is(actual, expected), `${name}: ${actual} != ${expected}`); ok(name); }
function throws(fn, name) { try { fn(); } catch (_) { ok(name); return; } throw new Error(`${name}: expected error`); }
function sameBytes(a, b, name) { assert(a.length === b.length && a.every((v, i) => v === b[i]), name); ok(name); }
function sample() {
  const preset = P.createEmptyPreset(42, "测试");
  preset.actions[0] = { kind: P.Kind.KeyChord, mods: 1, code: 0x06, wheelDy: 0 };
  preset.actions[16] = { kind: P.Kind.Wheel, mods: 4, code: 0, wheelDy: 1 };
  preset.actions[17] = { kind: P.Kind.Consumer, mods: 0, code: 0xCD, wheelDy: 0 };
  preset.actions[18] = { kind: P.Kind.KeyChord, mods: 8, code: 0, wheelDy: 0 };
  preset.actions[P.SIDE_KEY_SLOT] = { kind: P.Kind.KeyChord, mods: 0x80, code: 0xE7, wheelDy: 0 };
  return preset;
}

equal(P.ACTION_COUNT, 22, "22 action slots including SideKey");
equal(P.ENCODERS.length, 3, "three encoder groups");
equal(P.ENCODERS[0].cwSlot, 16, "center CW slot");
equal(P.ENCODERS[0].ccwSlot, 17, "center CCW slot");
equal(P.ENCODERS[2].pressSlot, 14, "wheel press is a button slot");
equal(P.presetErrors(sample()).length, 0, "sample preset is valid");
equal(P.actionError({ kind: P.Kind.KeyChord, mods: 0, code: 0, wheelDy: 0 }, true) !== null, true,
  "empty KeyChord rejected");
equal(P.actionError({ kind: P.Kind.KeyChord, mods: 1, code: 0, wheelDy: 0 }, true), null,
  "modifier-only KeyChord is valid");
equal(P.actionError({ kind: P.Kind.Wheel, mods: 0, code: 0, wheelDy: 1 }, true) !== null, true,
  "Wheel rejected on button slots");
equal(P.actionError({ kind: P.Kind.Wheel, mods: 0, code: 0, wheelDy: 1 }, false), null,
  "Wheel accepted on encoder slots");
equal(P.actionError({ kind: P.Kind.Consumer, mods: 1, code: 0xCD, wheelDy: 0 }, false) !== null, true,
  "Consumer modifiers rejected");
equal(P.actionError({ kind: P.Kind.KeyChord, mods: 0, code: 0xE8, wheelDy: 0 }, true) !== null, true,
  "KeyChord usage above E7 rejected");
equal(P.nameError("中文名称测试"), null, "Chinese name within byte budget");
equal(P.utf8Length("中文名称测试"), 18, "Chinese byte count is not character count");
equal(P.nameError("中文名称测试超长") !== null, true, "Chinese name above byte budget rejected");
equal(P.utf8Length("1234567"), 7, "ASCII byte count");
equal(P.nameError("中中中中中中中中") !== null, true, "eight Chinese characters exceed 23 bytes");
equal(P.nameError("😀😀😀😀😀"), null, "five emoji fit the byte budget");
equal(P.nameError("😀😀😀😀😀😀") !== null, true, "six emoji exceed the byte budget");
equal(P.nameError("\uD800") !== null, true, "unpaired surrogate rejected");
equal(P.nameError("a\0b") !== null, true, "NUL in name rejected");

const encoded = P.encodePresetRecord(sample());
equal(encoded.length, 150, "encoded record is 150 bytes");
equal(encoded[2], 1, "record version");
equal(encoded[6], 42, "preset ID");
equal(encoded[7], 6, "UTF-8 name length in bytes");
equal(encoded[148] | encoded[149] << 8, P.crc16(encoded.subarray(0, 148)), "CRC stored at offset 148");
const decoded = P.decodePresetRecord(encoded);
equal(decoded.name, "测试", "name round trip");
equal(decoded.actions[0].code, 0x06, "button action round trip");
equal(decoded.actions[16].wheelDy, 1, "encoder Wheel round trip");
equal(decoded.actions[17].kind, P.Kind.Consumer, "encoder Consumer round trip");
equal(decoded.actions[18].mods, 8, "modifier-only encoder action round trip");
equal(decoded.actions[P.SIDE_KEY_SLOT].mods, 0x80, "SideKey modifiers preserved");
equal(decoded.actions[P.SIDE_KEY_SLOT].code, 0xE7, "SideKey code preserved");
sameBytes(P.encodePresetRecord(decoded), encoded, "encode/decode/encode is byte-identical");
const badCrc = encoded.slice(); badCrc[148] ^= 1;
throws(() => P.decodePresetRecord(badCrc), "bad CRC rejected");
const badVersion = encoded.slice(); badVersion[2] = 2;
throws(() => P.decodePresetRecord(badVersion), "unsupported record version rejected");
const badName = encoded.slice(); badName[7] = 24;
throws(() => P.decodePresetRecord(badName), "oversized encoded name rejected");
const badPadding = encoded.slice(); badPadding[30] = 1;
throws(() => P.decodePresetRecord(badPadding), "nonzero name padding rejected");
const badAction = encoded.slice(); badAction[38 + 5] = 1; badAction[38 + 5 + 1] = 0; badAction[38 + 5 + 2] = 0;
badAction[38 + 5 + 3] = 0; badAction[38 + 5 + 4] = 0;
badAction.set([P.crc16(badAction.subarray(0, 148)) & 255, P.crc16(badAction.subarray(0, 148)) >> 8], 148);
throws(() => P.decodePresetRecord(badAction), "invalid action payload rejected");
equal(P.actionLabel(sample().actions[0]), "Ctrl+C", "short action label");
equal(P.actionLabel(sample().actions[16]), "Alt+滚轮+1", "encoder label includes direction");
equal(P.actionLabel(sample().actions[18]), "Win", "modifier-only action omits zero usage code");
equal(P.crc16(new TextEncoder().encode("123456789")), 0x29B1, "CRC16 standard reference vector");
equal(P.crc16, Proto.crc16, "record and protocol share CRC16 implementation");
equal(P.MOD_LABELS.join(","), "Ctrl,Shift,Alt,Win,RCtrl,RShift,RAlt,RWin", "shared modifier labels");
equal(P.MOD_LABELS_MAC.join(","), "Ctrl,Shift,Opt,Cmd,RCtrl,RShift,ROpt,RCmd", "mac modifier labels");
equal(P.normalizePlatform("mac"), "mac", "known platform passes through");
equal(P.normalizePlatform("android"), "win", "unknown platform falls back to win");
equal(P.normalizePlatform(undefined), "win", "missing platform falls back to win");
equal(P.modLabels("ipad")[3], "Cmd", "ipad shares the mac label set");
const macChord = { kind: P.Kind.KeyChord, mods: 8 | 2, code: 0x1D, wheelDy: 0 };
equal(P.actionLabel(macChord, "mac"), "Shift+Cmd+Z", "mac labels use Cmd and Opt wording");
equal(P.actionLabel(macChord, "ipad"), "Shift+Cmd+Z", "ipad labels match mac");
equal(P.actionLabel(macChord), "Shift+Win+Z", "default platform stays win wording");
// 平台随 150B 记录往返（byte 13，D23）：win=0 是历史记录的天然值
const macSample = sample(); macSample.platform = "mac";
equal(P.encodePresetRecord(macSample)[13], 1, "platform mac encodes as 0x01 at byte 13");
equal(P.decodePresetRecord(P.encodePresetRecord(macSample)).platform, "mac", "platform round trips through the record");
equal(P.encodePresetRecord(sample())[13], 0, "platform win encodes as 0x00 at byte 13");
const unknownPlatform = P.encodePresetRecord(sample()); unknownPlatform[13] = 3;
unknownPlatform.set([P.crc16(unknownPlatform.subarray(0, 148)) & 255, P.crc16(unknownPlatform.subarray(0, 148)) >> 8], 148);
throws(() => P.decodePresetRecord(unknownPlatform), "unknown platform code rejected");
const badReserved12 = P.encodePresetRecord(sample()); badReserved12[12] = 1;
badReserved12.set([P.crc16(badReserved12.subarray(0, 148)) & 255, P.crc16(badReserved12.subarray(0, 148)) >> 8], 148);
throws(() => P.decodePresetRecord(badReserved12), "nonzero reserved byte 12 rejected");
equal(P.createEmptyPreset().platform, "win", "new presets default to win platform");
const exchanged = P.clonePresetData({ ...sample(), platform: "ipad", uuid: "x" });
equal(exchanged.platform, "ipad", "exchange data keeps the platform tag");
equal(P.clonePresetData({ ...sample(), platform: "android" }).platform, "win", "exchange data sanitizes the platform tag");
const keyAction = P.actionForKind(P.Kind.KeyChord);
equal(P.actionError(keyAction, false), null, "Wheel to KeyChord produces a valid reset action");
equal(keyAction.wheelDy, 0, "KeyChord default clears wheel delta");
equal(keyAction.code > 0 || keyAction.mods > 0, true, "KeyChord default is not empty");
equal(P.actionError(P.actionForKind(P.Kind.None), false), null, "None default is valid");
equal(P.actionError(P.actionForKind(P.Kind.Consumer), false), null, "Consumer default is valid");
equal(P.actionError(P.actionForKind(P.Kind.Wheel), false), null, "Wheel default is valid");
const changedWheel = P.actionForKind(P.Kind.Wheel);
changedWheel.wheelDy = -1;
equal(P.actionForKind(P.Kind.Wheel).wheelDy, 1, "kind defaults return independent actions");
const modifiedKey = { kind: P.Kind.KeyChord, mods: 5, code: 0x06, wheelDy: 0 };
equal(P.actionForKind(P.Kind.Wheel, modifiedKey).mods, 5, "KeyChord to Wheel preserves modifiers");
equal(P.actionForKind(P.Kind.KeyChord, modifiedKey).mods, 5, "KeyChord reset preserves modifiers");
equal(P.actionForKind(P.Kind.Consumer, modifiedKey).mods, 0, "Consumer reset clears modifiers");
equal(P.actionForKind(P.Kind.None, modifiedKey).mods, 0, "None reset clears modifiers");
const internal = Object.assign(sample(), { uuid: "local", _dirty: true, _dirtySlots: [0], _device: true,
  _readonly: true, templateId: "Test", originTemplateId: "Test" });
const exportData = P.clonePresetData(internal);
equal(Object.keys(exportData).sort().join(","), "accent,actions,id,name,platform,rgbMode", "exchange data excludes internal fields");
equal(exportData.actions === internal.actions, false, "exchange data is deeply cloned");
equal(internal._dirty, true, "exchange data cloning preserves source state");
let dependencyError = null;
try { vm.runInNewContext(fs.readFileSync(require.resolve("./preset.js"), "utf8"), { self: {} }); }
catch (error) { dependencyError = error; }
equal(dependencyError?.message, "NavioEditorPreset requires NavioProto; load navio_proto.js first",
  "missing protocol dependency has an actionable error");

console.log(`\nAll ${passed} checks passed.`);
