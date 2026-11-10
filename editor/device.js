// 编辑器设备闭环：复用 Config Protocol v2，不持有 DOM 或本地库状态。
(function (root, factory) {
  const proto = root.NavioProto || (typeof require !== "undefined" ? require("../tools/probe/navio_proto.js") : null);
  const preset = root.NavioEditorPreset || (typeof require !== "undefined" ? require("./preset.js") : null);
  const bonds = root.NavioBleBonds || (typeof require !== "undefined" ? require("./ble_bonds.js") : null);
  const api = factory(proto, preset, bonds);
  root.NavioEditorDevice = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function (P, Preset, Bonds) {
  "use strict";

  const HID_FILTER = { vendorId: 0xCAFE, productId: 0xBEEF, usagePage: 0xFF00, usage: 1 };
  const textDecoder = () => new TextDecoder("utf-8", { fatal: true });

  function sameBytes(a, b) {
    return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length &&
      a.every((value, index) => value === b[index]);
  }

  function parseInfo(data) {
    const info = JSON.parse(textDecoder().decode(data));
    const required = [P.CMD.GET_PRESETS, P.CMD.WRITE_PRESET, P.CMD.DELETE, P.CMD.MOVE,
      P.CMD.READ_PRESET, P.CMD.READ_CHUNK];
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

  function resolveSlotTarget(preset, installed) {
    const planned = { ...preset };
    let target = installed.find(item => item.id === planned.id) || null;
    if (!target && planned._installedId) {
      target = installed.find(item => item.id === planned._installedId) || null;
      if (target) planned.id = target.id;
    }
    return { preset: planned, installed: target };
  }

  function samePresetContent(a, b) {
    return sameBytes(Preset.encodePresetRecord({ ...a, id: 1 }), Preset.encodePresetRecord({ ...b, id: 1 }));
  }

  function allocatePresetId(installed) {
    const used = new Set(installed.map(item => item.id));
    for (let id = 1; id <= 255; ++id) if (!used.has(id)) return id;
    throw new Error("没有可用的设备预设 ID");
  }

  function planInstall(source, installed, options = {}) {
    const errors = Preset.presetErrors(source);
    if (errors.length) throw new Error(errors[0]);
    const planned = Preset.clonePreset(source);
    let target = null;
    if (options.asNew) {
      planned.id = allocatePresetId(installed);
      delete planned._installedId;
    } else if (planned._installedId) {
      target = installed.find(item => item.id === planned._installedId) || null;
      if (target) planned.id = target.id;
      else if (installed.some(item => item.id === planned.id)) planned.id = allocatePresetId(installed);
    } else if (installed.some(item => item.id === planned.id)) {
      planned.id = allocatePresetId(installed);
    }
    if (!target && installed.length >= 6) {
      target = installed.find(item => item.id === options.replacementId) || null;
      if (!target) throw new Error("键盘已满，请选择要替换的预设");
      planned.id = target.id;
    }
    return { preset: planned, installed: target, asNew: Boolean(options.asNew) };
  }

  function planBatch(presets, installed) {
    const ids = new Set();
    for (const preset of presets) {
      const errors = Preset.presetErrors(preset);
      if (errors.length) throw new Error(`“${preset.name}”：${errors[0]}`);
      if (ids.has(preset.id)) throw new Error(`批量预设包含重复 ID ${preset.id}，请先整理本地库`);
      ids.add(preset.id);
    }
    const plans = presets.map(preset => resolveSlotTarget(preset, installed));
    const targetIds = new Set();
    for (const plan of plans) {
      if (targetIds.has(plan.preset.id)) throw new Error(`批量预设映射到重复设备 ID ${plan.preset.id}，请单独安装`);
      targetIds.add(plan.preset.id);
    }
    const newCount = plans.filter(plan => !plan.installed).length;
    if (installed.length + newCount > 6)
      throw new Error("批量应用将超过 6 套容量，请先单独选择要替换的设备预设");
    return plans;
  }

  function moveAnchor(entries, id, direction) {
    const index = entries.findIndex(entry => entry.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= entries.length || Math.abs(direction) !== 1) return null;
    return direction < 0 ? entries[target].id : (entries[target + 1]?.id || 0);
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
    async remove(id) {
      await this.session.request(P.CMD.DELETE, new Uint8Array([id]));
    }
    async move(id, beforeId) {
      await this.session.request(P.CMD.MOVE, new Uint8Array([id, beforeId]));
    }
    async listBonds() {
      const result = Bonds.parseBondList(await this.session.request(P.CMD.GET_BLE_BONDS));
      return Bonds.sortBonds(result.entries);
    }
    async deleteBond(bond) {
      await this.session.request(P.CMD.DELETE_BLE_BOND, Bonds.encodeDeleteBond(bond));
    }
    async clearBonds() {
      await this.session.request(P.CMD.CLEAR_BLE_BONDS);
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
    let aborted = false, closePromise = null;
    const onInputReport = event => {
      if (aborted || event.reportId !== 6) return;
      const report = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      if (!waiters.length) { reports.push(report); return; }
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      waiter.resolve(report);
    };
    device.addEventListener("inputreport", onInputReport);
    const abort = () => {
      if (closePromise) return closePromise;
      aborted = true; reports.length = 0;
      device.removeEventListener("inputreport", onInputReport);
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("设备连接已中止"));
      }
      closePromise = device.opened ? device.close().catch(() => {}) : Promise.resolve();
      return closePromise;
    };
    const transport = {
      send: frame => aborted ? Promise.reject(new Error("设备连接已中止")) : device.sendReport(6, frame),
      receive: timeoutMs => new Promise((resolve, reject) => {
        if (aborted) return reject(new Error("设备连接已中止"));
        if (reports.length) return resolve(reports.shift());
        const waiter = { resolve, reject, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new P.TimeoutError());
        }, timeoutMs) };
        waiters.push(waiter);
      }),
    };
    return { device, session: new P.Session(transport), abort };
  }

  return { HID_FILTER, sameBytes, samePresetContent, allocatePresetId, parseInfo, parsePresetList,
    resolveSlotTarget, planInstall, planBatch, moveAnchor, DeviceClient, connectHid };
});
