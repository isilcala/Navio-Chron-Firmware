(function (root, factory) {
  const api = factory();
  root.NavioBleBonds = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const MAX_BONDS = 3, ENTRY_SIZE = 13;

  function formatAddress(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 6) throw new Error("蓝牙地址格式错误");
    return [...bytes].reverse().map(value => value.toString(16).padStart(2, "0").toUpperCase()).join(":");
  }

  function parseBondList(data) {
    if (!(data instanceof Uint8Array) || data.length < 2 || data[0] !== 2)
      throw new Error("设备蓝牙绑定清单版本不受支持");
    const count = data[1];
    if (count > MAX_BONDS || data.length !== 2 + count * ENTRY_SIZE)
      throw new Error("设备蓝牙绑定清单长度错误");
    const entries = [], addresses = new Set();
    for (let index = 0; index < count; ++index) {
      const offset = 2 + index * ENTRY_SIZE, addressType = data[offset];
      if (addressType > 3) throw new Error("设备蓝牙地址类型非法");
      const address = data.slice(offset + 1, offset + 7), formatted = formatAddress(address);
      if (addresses.has(formatted)) throw new Error("设备蓝牙绑定包含重复地址");
      addresses.add(formatted);
      const lastUsedSeq = (data[offset + 8] + data[offset + 9] * 0x100 +
        data[offset + 10] * 0x10000 + data[offset + 11] * 0x1000000) >>> 0;
      const channel = data[offset + 12];
      if (channel !== 0xFF && (channel < 1 || channel > 3)) throw new Error("设备蓝牙频道编号非法");
      entries.push({ addressType, address, connected: Boolean(data[offset + 7] & 1), lastUsedSeq, channel });
    }
    return { version: 2, entries };
  }

  function sortBonds(entries) {
    return entries.map(entry => ({ ...entry })).sort((a, b) =>
      (a.channel === 0xFF ? 4 : a.channel) - (b.channel === 0xFF ? 4 : b.channel) ||
      Number(b.connected) - Number(a.connected) || b.lastUsedSeq - a.lastUsedSeq ||
      formatAddress(a.address).localeCompare(formatAddress(b.address)));
  }

  function encodeDeleteBond(entry) {
    if (!entry || !Number.isInteger(entry.addressType) || entry.addressType < 0 || entry.addressType > 3)
      throw new Error("蓝牙地址类型非法");
    const address = entry.address;
    if (!(address instanceof Uint8Array) || address.length !== 6) throw new Error("蓝牙地址格式错误");
    const body = new Uint8Array(7);
    body[0] = entry.addressType;
    body.set(address, 1);
    return body;
  }

  return { MAX_BONDS, ENTRY_SIZE, formatAddress, parseBondList, sortBonds, encodeDeleteBond };
});
