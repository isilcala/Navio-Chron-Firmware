// 编辑器设备闭环：复用 Config Protocol v2，不持有 DOM 或本地库状态。
(function (root, factory) {
  const proto = root.NavioProto || (typeof require !== "undefined" ? require("../tools/probe/navio_proto.js") : null);
  const preset = root.NavioEditorPreset || (typeof require !== "undefined" ? require("./preset.js") : null);
  const api = factory(proto, preset);
  root.NavioEditorDevice = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function (P, Preset) {
  "use strict";

  const HID_FILTER = { vendorId: 0xCAFE, productId: 0xBEEF, usagePage: 0xFF00, usage: 1 };
  const textDecoder = () => new TextDecoder("utf-8", { fatal: true });

  function sameBytes(a, b) {
    return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length &&
      a.every((value, index) => value === b[index]);
  }

  function parseInfo(data) {
    const info = JSON.parse(textDecoder().decode(data));
    const required = [P.CMD.GET_PRESETS, P.CMD.WRITE_PRESET, P.CMD.READ_PRESET, P.CMD.READ_CHUNK];
    if (info.record !== 1 || info.maxPresets !== 6 || !Array.isArray(info.cmds) ||
        !required.every(cmd => info.cmds.includes(cmd)))
      throw new Error("设备不支持预设记录 v1 或完整的读取/写入命令");
    return info;
  }

  function parsePresetList(data) {
    if (!(data instanceof Uint8Array) || data.length < 4) throw new Error("设备预设清单格式错误");
    const count = data[0], activeId = data[1], entries = [], ids = new Set();
    let offset = 2;
    for (let index = 0; index < count; ++index) {
      if (offset + 2 > data.length) throw new Error("设备预设清单被截断");
      const id = data[offset], nameLength = data[offset + 1];
      offset += 2;
      if (!id || ids.has(id) || !nameLength || nameLength > 23 || offset + nameLength > data.length)
        throw new Error("设备预设清单包含非法条目");
      const name = textDecoder().decode(data.subarray(offset, offset + nameLength));
      if (Preset.nameError(name)) throw new Error("设备预设名称非法");
      entries.push({ id, name });
      ids.add(id);
      offset += nameLength;
    }
    if (!count || count > 6 || offset !== data.length || !ids.has(activeId))
      throw new Error("设备预设清单数量或活动 ID 非法");
    return { activeId, entries };
  }

  class DeviceClient {
    constructor(session) { this.session = session; }
    async hello() {
      const hello = JSON.parse(textDecoder().decode(await this.session.request(P.CMD.HELLO)));
      if (hello.proto !== 2) throw new Error("设备不是 Config Protocol v2");
      return hello;
    }
    async info() { return parseInfo(await this.session.request(P.CMD.GET_INFO)); }
    async list() {
      return parsePresetList(await this.session.request(P.CMD.GET_PRESETS));
    }
    async read(id) {
      return Preset.decodePresetRecord(await this.session.request(P.CMD.READ_PRESET, new Uint8Array([id])));
    }
    async readInstalled() {
      const info = await this.info(), list = await this.list(), presets = [];
      for (const entry of list.entries) presets.push(await this.read(entry.id));
      return { info, activeId: list.activeId, presets };
    }
    async writeVerified(preset) {
      const encoded = Preset.encodePresetRecord(preset);
      await this.session.request(P.CMD.WRITE_PRESET, encoded);
      const actual = await this.session.request(P.CMD.READ_PRESET, new Uint8Array([preset.id]));
      if (!sameBytes(encoded, actual)) throw new Error("写入后重读不一致，设备内容未通过验证");
      return Preset.decodePresetRecord(actual);
    }
  }

  async function connectHid(hid) {
    if (!hid) throw new Error("当前浏览器不支持 WebHID，请使用桌面 Chrome 或 Edge");
    const matches = device => device.vendorId === HID_FILTER.vendorId && device.productId === HID_FILTER.productId;
    let device = (await hid.getDevices()).find(matches);
    if (!device) device = (await hid.requestDevice({ filters: [HID_FILTER] }))[0];
    if (!device) throw new Error("未选择设备");
    if (!device.opened) await device.open();
    const reports = [], waiters = [];
    device.addEventListener("inputreport", event => {
      if (event.reportId !== 6) return;
      const report = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      if (!waiters.length) { reports.push(report); return; }
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      waiter.resolve(report);
    });
    const transport = {
      send: frame => device.sendReport(6, frame),
      receive: timeoutMs => new Promise((resolve, reject) => {
        if (reports.length) return resolve(reports.shift());
        const waiter = { resolve, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new P.TimeoutError());
        }, timeoutMs) };
        waiters.push(waiter);
      }),
    };
    return { device, session: new P.Session(transport) };
  }

  return { HID_FILTER, sameBytes, parseInfo, parsePresetList, DeviceClient, connectHid };
});
