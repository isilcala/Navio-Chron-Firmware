const assert = require("node:assert/strict");
const B = require("./ble_bonds.js");
let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); ++passed; }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}
function entry(type, bytes, connected, seq, channel = 0xFF) {
  return [type, ...bytes, connected ? 1 : 0, seq & 255, (seq >>> 8) & 255, (seq >>> 16) & 255, (seq >>> 24) & 255, channel];
}
const a = [6, 5, 4, 3, 2, 1], b = [1, 2, 3, 4, 5, 6];

test("address formatting uses display byte order", () => assert.equal(B.formatAddress(new Uint8Array(a)), "01:02:03:04:05:06"));
test("channel labels cover assigned and unassigned channels", () => {
  assert.equal(B.channelLabel({ channel: 2 }), "频道 2");
  assert.equal(B.channelLabel({ channel: 0xFF }), "未分配频道");
});
test("bond list parses current state, recent sequence and channel", () => {
  const result = B.parseBondList(new Uint8Array([2, 2, ...entry(1, a, true, 9, 2), ...entry(2, b, false, 4, 1)]));
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].connected, true);
  assert.equal(result.entries[0].lastUsedSeq, 9);
  assert.equal(result.entries[0].channel, 2);
  assert.equal(result.entries[1].addressType, 2);
  assert.equal(result.entries[1].channel, 1);
});
test("bond list accepts empty response", () => assert.deepEqual(B.parseBondList(new Uint8Array([2, 0])), { version: 2, entries: [] }));
test("bond list rejects trailing bytes", () => assert.throws(() => B.parseBondList(new Uint8Array([2, 0, 0])), /长度/));
test("bond list rejects excessive count", () => assert.throws(() => B.parseBondList(new Uint8Array([2, 4])), /长度/));
test("bond list rejects unsupported version", () => assert.throws(() => B.parseBondList(new Uint8Array([1, 0])), /版本/));
test("bond list rejects invalid address type", () => assert.throws(() => B.parseBondList(new Uint8Array([2, 1, ...entry(4, a, false, 0)])), /类型/));
test("bond list rejects invalid channel", () => assert.throws(() => B.parseBondList(new Uint8Array([2, 1, ...entry(1, a, false, 0, 4)])), /频道/));
test("bond list rejects duplicate addresses", () => assert.throws(() => B.parseBondList(new Uint8Array([2, 2, ...entry(1, a, false, 1), ...entry(1, a, true, 2)])), /重复/));
test("sort places bonds in channel order", () => {
  const entries = B.parseBondList(new Uint8Array([2, 3, ...entry(1, a, false, 2, 3), ...entry(1, b, false, 8, 1), ...entry(2, [9, 9, 9, 9, 9, 9], true, 1, 2)])).entries;
  const sorted = B.sortBonds(entries);
  assert.equal(sorted[0].channel, 1);
  assert.equal(sorted[1].channel, 2);
  assert.equal(sorted[1].connected, true);
  assert.equal(sorted[2].channel, 3);
  assert.equal(entries[0].lastUsedSeq, 2);
});
test("delete body uses address rather than list index", () => {
  assert.deepEqual([...B.encodeDeleteBond({ addressType: 2, address: new Uint8Array(a) })], [2, ...a]);
});
test("delete body rejects malformed address", () => assert.throws(() => B.encodeDeleteBond({ addressType: 1, address: new Uint8Array(5) }), /格式/));
console.log(`All ${passed} BLE bond checks passed.`);
