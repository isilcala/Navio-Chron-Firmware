const assert = require("node:assert/strict");
const P = require("../tools/probe/navio_proto.js");
const Preset = require("./preset.js");
const D = require("./device.js");
let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); ++passed; }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}
async function asyncTest(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); ++passed; }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}
function bytes(text) { return new TextEncoder().encode(text); }
function list(entries, activeId = entries[0].id) {
  return P.concat(new Uint8Array([entries.length, activeId]),
    ...entries.map(entry => P.concat(new Uint8Array([entry.id, bytes(entry.name).length]), bytes(entry.name))));
}
const sample = Preset.createEmptyPreset(1, "设备预设");
sample.actions[0] = { kind: Preset.Kind.KeyChord, mods: 0, code: 4, wheelDy: 0 };
const info = { record: 1, maxPresets: 6, cmds: [1, 2, 3, 4, 8, 9] };

test("byte comparison accepts identical records", () => assert.equal(D.sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true));
test("byte comparison rejects different records", () => assert.equal(D.sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false));
test("preset list parses stable IDs and active ID", () => {
  assert.deepEqual(D.parsePresetList(list([{ id: 2, name: "Resolve" }, { id: 1, name: "剪映" }], 1)),
    { activeId: 1, entries: [{ id: 2, name: "Resolve" }, { id: 1, name: "剪映" }] });
});
test("preset list rejects trailing bytes", () => assert.throws(() => D.parsePresetList(P.concat(list([{ id: 1, name: "A" }]), new Uint8Array([0])))));
test("preset list rejects duplicate IDs", () => assert.throws(() => D.parsePresetList(list([{ id: 1, name: "A" }, { id: 1, name: "B" }]))));
test("preset list rejects unknown active ID", () => assert.throws(() => D.parsePresetList(list([{ id: 1, name: "A" }], 2))));
test("preset list rejects invalid UTF-8", () => assert.throws(() => D.parsePresetList(new Uint8Array([1, 1, 1, 1, 0xFF]))));
test("capability check accepts record v1 and required commands", () => assert.deepEqual(D.parseInfo(bytes(JSON.stringify(info))), info));
test("capability check rejects unsupported record", () => assert.throws(() => D.parseInfo(bytes(JSON.stringify({ ...info, record: 2 }))), /不支持/));
test("capability check rejects missing write", () => assert.throws(() => D.parseInfo(bytes(JSON.stringify({ ...info, cmds: [1, 2, 3, 8, 9] }))), /不支持/));

(async () => {
  await asyncTest("readInstalled reads every listed record", async () => {
    const calls = [], record = Preset.encodePresetRecord(sample);
    const session = { request: async (cmd, body = new Uint8Array()) => {
      calls.push([cmd, ...body]);
      if (cmd === P.CMD.GET_INFO) return bytes(JSON.stringify(info));
      if (cmd === P.CMD.GET_PRESETS) return list([{ id: 1, name: sample.name }]);
      if (cmd === P.CMD.READ_PRESET) return record;
      throw new Error("unexpected command");
    } };
    const result = await new D.DeviceClient(session).readInstalled();
    assert.equal(result.activeId, 1);
    assert.deepEqual(result.presets, [sample]);
    assert.deepEqual(calls.map(call => call[0]), [P.CMD.GET_INFO, P.CMD.GET_PRESETS, P.CMD.READ_PRESET]);
  });
  await asyncTest("writeVerified writes and rereads exact bytes", async () => {
    const calls = [], encoded = Preset.encodePresetRecord(sample);
    const session = { request: async (cmd, body = new Uint8Array()) => {
      calls.push([cmd, ...body]);
      if (cmd === P.CMD.WRITE_PRESET) return new Uint8Array();
      if (cmd === P.CMD.READ_PRESET) return encoded;
      throw new Error("unexpected command");
    } };
    assert.deepEqual(await new D.DeviceClient(session).writeVerified(sample), sample);
    assert.deepEqual(calls.map(call => call[0]), [P.CMD.WRITE_PRESET, P.CMD.READ_PRESET]);
  });
  await asyncTest("writeVerified rejects a mismatching readback", async () => {
    const changed = Preset.encodePresetRecord(sample);
    changed[40] = 5;
    const session = { request: async cmd => cmd === P.CMD.READ_PRESET ? changed : new Uint8Array() };
    await assert.rejects(() => new D.DeviceClient(session).writeVerified(sample), /重读不一致/);
  });
  await asyncTest("hello rejects protocol v1", async () => {
    const session = { request: async () => bytes('{"proto":1}') };
    await assert.rejects(() => new D.DeviceClient(session).hello(), /Protocol v2/);
  });
  console.log(`All ${passed} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
