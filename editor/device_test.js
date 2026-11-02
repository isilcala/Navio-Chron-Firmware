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
const info = { record: 1, maxPresets: 6, cmds: [1, 2, 3, 4, 5, 6, 7, 8, 9] };

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
test("batch plan distinguishes update and install", () => {
  const added = { ...Preset.clonePreset(sample), id: 2, name: "New" };
  const plans = D.planBatch([sample, added], [{ id: 1, name: "Old" }]);
  assert.equal(plans[0].installed.id, 1); assert.equal(plans[1].installed, null);
});
test("batch plan rejects duplicate local IDs", () => assert.throws(() => D.planBatch([sample, sample], []), /重复 ID/));
test("batch plan rejects invalid records before writes", () => {
  const invalid = Preset.clonePreset(sample); invalid.name = "";
  assert.throws(() => D.planBatch([invalid], []), /name is empty/);
});
test("batch plan rejects capacity overflow", () => {
  const installed = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, name: `P${index}` }));
  const added = { ...Preset.clonePreset(sample), id: 7 };
  assert.throws(() => D.planBatch([added], installed), /超过 6 套/);
});
test("batch plan reuses a recorded device slot without changing the local ID", () => {
  const bound = { ...Preset.clonePreset(sample), id: 7, _installedId: 3 };
  const installed = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, name: `P${index}` }));
  const plans = D.planBatch([bound], installed);
  assert.equal(plans[0].preset.id, 3);
  assert.equal(plans[0].installed.id, 3);
  assert.equal(bound.id, 7);
});
test("slot resolution prefers a direct ID match over the hint", () => {
  const bound = { ...Preset.clonePreset(sample), id: 7, _installedId: 3 };
  const result = D.resolveSlotTarget(bound, [{ id: 3, name: "P3" }, { id: 7, name: "P7" }]);
  assert.equal(result.preset.id, 7);
  assert.equal(result.installed.name, "P7");
});
test("batch plan rejects multiple presets targeting the same hinted slot", () => {
  const first = { ...Preset.clonePreset(sample), id: 7, _installedId: 3 };
  const second = { ...Preset.clonePreset(sample), id: 8, _installedId: 3 };
  assert.throws(() => D.planBatch([first, second], [{ id: 3, name: "P3" }]), /重复设备 ID 3/);
});
test("move up targets the previous entry", () => assert.equal(D.moveAnchor([{ id: 1 }, { id: 2 }, { id: 3 }], 3, -1), 2));
test("move down targets the entry after next", () => assert.equal(D.moveAnchor([{ id: 1 }, { id: 2 }, { id: 3 }], 1, 1), 3));
test("move to last uses zero anchor", () => assert.equal(D.moveAnchor([{ id: 1 }, { id: 2 }], 1, 1), 0));
test("move boundaries are rejected", () => {
  assert.equal(D.moveAnchor([{ id: 1 }], 1, -1), null);
  assert.equal(D.moveAnchor([{ id: 1 }], 1, 1), null);
  assert.equal(D.moveAnchor([{ id: 1 }], 2, 1), null);
});

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
  await asyncTest("delete and move use stable-ID request bodies", async () => {
    const calls = [];
    const session = { request: async (cmd, body) => { calls.push([cmd, ...body]); return new Uint8Array(); } };
    const client = new D.DeviceClient(session);
    await client.remove(7); await client.move(3, 0);
    assert.deepEqual(calls, [[P.CMD.DELETE, 7], [P.CMD.MOVE, 3, 0]]);
  });
  await asyncTest("abort rejects pending HID reads and blocks old-session sends", async () => {
    const device = new EventTarget();
    let added = 0, removed = 0, closes = 0;
    const add = device.addEventListener.bind(device), remove = device.removeEventListener.bind(device);
    Object.assign(device, { vendorId: D.HID_FILTER.vendorId, productId: D.HID_FILTER.productId,
      opened: true, sendReport: async () => { throw new Error("old session sent a report"); },
      addEventListener: (...args) => { ++added; add(...args); },
      removeEventListener: (...args) => { ++removed; remove(...args); },
      close: async () => { ++closes; device.opened = false; } });
    const hid = { getDevices: async () => [device] };
    const connection = await D.connectHid(hid);
    const pending = connection.session.transport.receive(10000);
    const firstClose = connection.abort(), secondClose = connection.abort();
    assert.equal(firstClose, secondClose);
    await firstClose;
    await assert.rejects(pending, /已中止/);
    await assert.rejects(connection.session.transport.send(new Uint8Array(63)), /已中止/);
    await assert.rejects(connection.session.transport.receive(1), /已中止/);
    assert.deepEqual({ added, removed, closes, opened: device.opened }, { added: 1, removed: 1, closes: 1, opened: false });
  });
  await asyncTest("hello rejects protocol v1", async () => {
    const session = { request: async () => bytes('{"proto":1}') };
    await assert.rejects(() => new D.DeviceClient(session).hello(), /Protocol v2/);
  });
  console.log(`All ${passed} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
