// 运行：node editor/preset_test.js
"use strict";
const P = require("./preset.js");
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

console.log(`\nAll ${passed} checks passed.`);
