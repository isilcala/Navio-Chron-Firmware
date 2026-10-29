// navio_proto.js 自测：CRC 校验值、帧编解码往返、分片数学，
// 以及用按 PROTOCOL.md 实现的内存模拟设备跑 Session 状态机（含故障注入）。
// 运行：node tools/probe/navio_proto_test.js
"use strict";
const P = require("./navio_proto.js");

let passed = 0;
function ok(name) { passed++; console.log("PASS", name); }
function assert(cond, msg) { if (!cond) throw new Error("assert: " + msg); }
async function expectErr(code, detail, fn, name) {
  try { await fn(); } catch (e) {
    if (e instanceof P.ProtoError && e.code === code && (detail === undefined || e.detail === detail)) {
      ok(name); return;
    }
    throw new Error(`${name}: expected ProtoError ${code}/${detail}, got ${e}`);
  }
  throw new Error(`${name}: expected ProtoError ${code}, no error thrown`);
}

// ---- 模拟设备：严格按 PROTOCOL.md 的设备侧行为（HELLO/GET_INFO/WRITE_PRESET 子集）----
const HELLO_JSON = new TextEncoder().encode('{"proto":2,"fw":"0.4.0-dev","name":"Navio Chron"}');
const INFO_JSON = new TextEncoder().encode('{"record":1,"maxBody":2048,"maxPresets":6,"cmds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]}');

class MockDevice {
  constructor() {
    this.responses = []; // 待主机 receive 的帧队列
    this.rx = null;      // 活动接收事务 {cmd, total, buf, expectedSeq}
    this.pendingLarge = null; // 待拉取大响应 {data, cursor}
    this.silentDrop = false;  // 模拟设备丢帧（不回复）
  }

  ackFrame(echoCmd, seq, status, data = new Uint8Array()) {
    return P.encodeRequest(P.CMD.ACK, P.concat(new Uint8Array([echoCmd, seq, status]), data))[0];
  }
  errFrame(echoCmd, seq, code, detail = 0) {
    return P.encodeRequest(P.CMD.ERR, new Uint8Array([echoCmd, seq, code, detail]))[0];
  }

  handleFrame(frame) {
    if (P.crc8(frame.subarray(0, 62)) !== frame[62]) return; // CRC8 失败静默丢弃
    if (this.silentDrop) { this.silentDrop = false; return; }
    const [magic, cmd, seq, total] = frame;
    const payload = frame.subarray(4, 62);
    if (magic !== P.MAGIC) { this.responses.push(this.errFrame(cmd, seq, P.ERR.BAD_MAGIC)); return; }

    if (cmd === P.CMD.READ_CHUNK) { // 普通单片消息；不取消待拉取响应
      const bodyLength = P.u16(payload, 0);
      const body = payload.subarray(4, 4 + bodyLength);
      if (bodyLength !== 1 || P.crc16(body) !== P.u16(payload, 2)) {
        this.responses.push(this.errFrame(cmd, seq, P.ERR.CHECKSUM)); return;
      }
      const chunkSeq = body[0];
      if (!this.pendingLarge) {
        this.responses.push(this.errFrame(cmd, seq, P.ERR.BAD_STATE)); return;
      }
      const { data, cursor } = this.pendingLarge;
      const totalChunks = P.chunkCount(data.length);
      if (chunkSeq === cursor - 1) { /* 重复请求：重发同一片 */ }
      else if (chunkSeq !== cursor) {
        this.responses.push(this.errFrame(cmd, seq, P.ERR.BAD_SEQ, cursor)); return;
      } else {
        this.pendingLarge.cursor++;
      }
      const reply = new Uint8Array(P.FRAME_SIZE);
      reply.set([P.MAGIC, P.CMD.ACK, chunkSeq, totalChunks,
                 P.CMD.READ_CHUNK, chunkSeq, P.STATUS.CHUNK], 0);
      reply.set(data.subarray(chunkSeq * 55, chunkSeq * 55 + 55), 7);
      reply[62] = P.crc8(reply.subarray(0, 62));
      this.responses.push(reply);
      return;
    }

    if (seq === 0) { // 隐式取消旧事务
      const bodyLength = P.u16(payload, 0);
      if (bodyLength > P.BODY_MAX) {
        this.responses.push(this.errFrame(cmd, 0, P.ERR.OVERFLOW)); return;
      }
      const expectedTotal = P.fragmentCount(bodyLength);
      if (total !== expectedTotal || total > P.FRAGMENT_MAX) {
        this.responses.push(this.errFrame(cmd, 0, P.ERR.BAD_TOTAL)); return;
      }
      this.rx = { cmd, total, buf: [], expectedSeq: 0 };
      this.pendingLarge = null;
    } else if (!this.rx || cmd !== this.rx.cmd) {
      this.responses.push(this.errFrame(cmd, seq, P.ERR.BAD_STATE)); return;
    }
    if (seq !== this.rx.expectedSeq) {
      if (seq === this.rx.expectedSeq - 1) { // 重复片：重复确认，不重复追加
        this.responses.push(this.ackFrame(cmd, seq, P.STATUS.CHUNK)); return;
      }
      this.responses.push(this.errFrame(cmd, seq, P.ERR.BAD_SEQ, this.rx.expectedSeq)); return;
    }
    this.rx.buf.push(payload);
    this.rx.expectedSeq++;

    if (seq + 1 < total) { // 中间片 ACK（total=1 无中间片）
      this.responses.push(this.ackFrame(cmd, seq, P.STATUS.CHUNK)); return;
    }
    // 最后一片：整体校验
    const stream = P.concat(...this.rx.buf);
    const bodyLength = P.u16(stream, 0);
    const body = stream.subarray(4, 4 + bodyLength);
    this.rx = null;
    if (P.crc16(body) !== P.u16(stream, 2)) {
      this.responses.push(this.errFrame(cmd, seq, P.ERR.CHECKSUM)); return;
    }
    let data;
    if (cmd === P.CMD.HELLO) data = HELLO_JSON;
    else if (cmd === P.CMD.GET_INFO) data = INFO_JSON;
    else if (cmd === P.CMD.WRITE_PRESET) data = new Uint8Array();
    else { this.responses.push(this.errFrame(cmd, seq, P.ERR.NOT_IMPLEMENTED)); return; }
    if (data.length <= P.SMALL_RESPONSE_MAX) {
      this.responses.push(this.ackFrame(cmd, seq, P.STATUS.OK, data));
    } else {
      this.pendingLarge = { data, cursor: 0 };
      const meta = new Uint8Array([...P.le16(data.length), ...P.le16(P.crc16(data))]);
      this.responses.push(this.ackFrame(cmd, seq, P.STATUS.MORE, meta));
    }
  }
}

function wireTransport(device) {
  const waiters = [];
  return {
    send: async (frame) => {
      device.handleFrame(frame);
      // 同步 transport：响应即刻入队，投递给已注册的 receive waiter
      while (device.responses.length && waiters.length) {
        const waiter = waiters.shift();
        clearTimeout(waiter.timer);
        waiter.resolve(device.responses.shift());
      }
    },
    receive: (timeoutMs) => new Promise((resolve, reject) => {
      if (device.responses.length) return resolve(device.responses.shift());
      const waiter = { resolve, timer: setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new P.TimeoutError());
      }, timeoutMs) };
      waiters.push(waiter);
    }),
  };
}

async function main() {
  // 1. CRC 校验值（PROTOCOL.md §4）
  const digits = new TextEncoder().encode("123456789");
  assert(P.crc8(digits) === 0xf4, "crc8 check value");
  assert(P.crc16(digits) === 0x29b1, "crc16 check value");
  assert(P.crc16(new Uint8Array()) === 0xffff, "empty crc16");
  ok("CRC reference vectors");

  // 2. 分片数学（§3/§8）
  assert(P.fragmentCount(0) === 1 && P.fragmentCount(54) === 1 && P.fragmentCount(55) === 2);
  assert(P.fragmentCount(2044) === 36 && P.fragmentCount(2048) === 36);
  assert(P.chunkCount(51) === 1 && P.chunkCount(52) === 1 && P.chunkCount(56) === 2);
  assert(P.chunkCount(2048) === 38);
  ok("fragment/chunk count math");

  // 3. 帧编解码往返：多片请求的拼接流必须等于消息流（regression：seq0 偏移 bug）
  const body = new Uint8Array(120).map((_, i) => i);
  const frames = P.encodeRequest(P.CMD.WRITE_PRESET, body);
  assert(frames.length === P.fragmentCount(120), "frame count");
  const reassembled = P.concat(...frames.map((f) => f.subarray(4, 62)));
  const stream = P.messageStream(body);
  for (let i = 0; i < stream.length; ++i)
    assert(reassembled[i] === stream[i], `stream byte ${i}`);
  assert(P.u16(reassembled, 0) === 120 && P.u16(reassembled, 2) === P.crc16(body));
  for (const f of frames) assert(P.crc8(f.subarray(0, 62)) === f[62], "frame crc8");
  ok("multi-fragment encode/reassembly round-trip");

  // 4. Session 正常路径：HELLO 小响应（≤51B 直接附带）
  const device = new MockDevice();
  const transport = wireTransport(device);
  const session = new P.Session(transport, { timeoutMs: 50 });
  const hello = JSON.parse(new TextDecoder().decode(await session.request(P.CMD.HELLO)));
  assert(hello.proto === 2 && hello.name === "Navio Chron", "HELLO fields");
  ok("HELLO small response path");

  // 5. GET_INFO 大响应：MORE + READ_CHUNK 拉取（>51B）
  const info = JSON.parse(new TextDecoder().decode(await session.request(P.CMD.GET_INFO)));
  assert(info.maxBody === 2048 && info.cmds.length === 16, "GET_INFO fields");
  ok("GET_INFO large response via MORE/READ_CHUNK");

  // 6. 多片 WRITE_PRESET 正常确认
  await session.request(P.CMD.WRITE_PRESET, body);
  ok("multi-fragment WRITE_PRESET accepted");

  {
    const stream = P.messageStream(new Uint8Array(60));
    const f0 = P.encodeFrame(P.CMD.WRITE_PRESET, 0, 2, stream.subarray(0, 58));
    const f1 = P.encodeFrame(P.CMD.WRITE_PRESET, 1, 2, stream.subarray(58, 116));
    P.parseAckErr(await session.exchange(f0));
    device.responses.push(device.ackFrame(P.CMD.WRITE_PRESET, 0, P.STATUS.CHUNK));
    const ack1 = P.parseAckErr(await session.exchange(f1));
    assert(ack1.seq === 1, "late duplicate ACK must not satisfy the next fragment");
    ok("late duplicate ACK is discarded");
  }

  // 7. 故障注入
  await expectErr(P.ERR.BAD_MAGIC, undefined, async () => {
    const f = P.encodeRequest(P.CMD.GET_INFO)[0];
    f[0] = 0; f[62] = P.crc8(f.subarray(0, 62)); // magic 错但 CRC8 正确
    P.parseAckErr(await session.exchange(f));
  }, "bad magic -> ERR_BAD_MAGIC");

  await expectErr(P.ERR.BAD_TOTAL, undefined, async () => {
    // total=2 但 bodyLength=0 → 应为 1
    const f = P.encodeFrame(P.CMD.GET_INFO, 0, 2, P.messageStream(new Uint8Array()));
    P.parseAckErr(await session.exchange(f));
  }, "bad total -> ERR_BAD_TOTAL");

  await expectErr(P.ERR.OVERFLOW, undefined, async () => {
    const f = P.encodeFrame(P.CMD.GET_INFO, 0, 36,
      P.concat(new Uint8Array(P.le16(2049)), new Uint8Array(P.le16(0))));
    P.parseAckErr(await session.exchange(f));
  }, "oversized body -> ERR_OVERFLOW");

  await expectErr(P.ERR.BAD_STATE, undefined, async () => {
    const f = P.encodeFrame(P.CMD.GET_PRESETS, 1, 1, P.messageStream(new Uint8Array()));
    P.parseAckErr(await session.exchange(f));
  }, "seq>0 without active transaction -> ERR_BAD_STATE");

  await expectErr(P.ERR.CHECKSUM, undefined, async () => {
    // 两片 WRITE_PRESET，声明的 bodyCrc16 故意错误：中间片 CHUNK，末片 CHECKSUM
    const badBody = new Uint8Array(60).map((_, i) => i);
    const stream = P.concat(new Uint8Array(P.le16(60)),
      new Uint8Array(P.le16(P.crc16(badBody) ^ 1)), badBody);
    const f0 = P.encodeFrame(P.CMD.WRITE_PRESET, 0, 2, stream.subarray(0, 58));
    const ack0 = P.parseAckErr(await session.exchange(f0));
    assert(ack0.status === P.STATUS.CHUNK, "intermediate CHUNK");
    const f1 = P.encodeFrame(P.CMD.WRITE_PRESET, 1, 2, stream.subarray(58, 116));
    P.parseAckErr(await session.exchange(f1));
  }, "multi-fragment bad CRC16 -> ERR_CHECKSUM on final fragment");

  await expectErr(P.ERR.BAD_SEQ, 1, async () => {
    const goodBody = new Uint8Array(60);
    const stream = P.messageStream(goodBody);
    await session.exchange(P.encodeFrame(P.CMD.WRITE_PRESET, 0, 2, stream.subarray(0, 58)));
    // 跳变：期望 1 却收到 2
    P.parseAckErr(await session.exchange(
      P.encodeFrame(P.CMD.WRITE_PRESET, 2, 2, stream.subarray(58, 116))));
  }, "out-of-order fragment -> ERR_BAD_SEQ(detail=expected)");

  await expectErr(P.ERR.BAD_STATE, undefined, async () => {
    await session.request(P.CMD.HELLO); // seq=0 隐式取消旧事务
    const stream = P.messageStream(new Uint8Array(60));
    P.parseAckErr(await session.exchange(
      P.encodeFrame(P.CMD.WRITE_PRESET, 1, 2, stream.subarray(58, 116))));
  }, "seq=0 implicit cancel, stale fragment -> ERR_BAD_STATE");

  // 8. READ_CHUNK 重复与乱序（§8.2）
  {
    const frames = P.encodeRequest(P.CMD.GET_INFO);
    const ack = P.parseAckErr(await session.exchange(frames[0]));
    assert(ack.status === P.STATUS.MORE, "MORE expected");
    const length = P.u16(ack.data, 0);
    const total = P.chunkCount(length);
    const req0 = P.encodeRequest(P.CMD.READ_CHUNK, new Uint8Array([0]))[0];
    const c0a = P.parseChunk(await session.exchange(req0), 0);
    const c0b = P.parseChunk(await session.exchange(req0), 0); // 重复请求重发同一片
    assert(c0a.seq === 0 && c0a.total === total && c0a.data.join() === c0b.data.join());
    await expectErr(P.ERR.BAD_SEQ, 1, async () => {
      const req2 = P.encodeRequest(P.CMD.READ_CHUNK, new Uint8Array([2]))[0];
      P.parseChunk(await session.exchange(req2), 2);
    }, "out-of-order READ_CHUNK -> ERR_BAD_SEQ(detail=1)");
    // 恢复正常拉完
    const parts = [c0a.data];
    for (let s = 1; s < total; ++s) {
      const req = P.encodeRequest(P.CMD.READ_CHUNK, new Uint8Array([s]))[0];
      parts.push(P.parseChunk(await session.exchange(req), s).data);
    }
    const data = P.concat(...parts).slice(0, length);
    assert(P.crc16(data) === P.u16(ack.data, 2), "reassembled crc16");
    ok("READ_CHUNK duplicate + resume after fault");
  }

  console.log(`\nAll ${passed} checks passed.`);
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
