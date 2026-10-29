// Navio Config Protocol v2 主机侧参考实现（docs/PROTOCOL.md 为单一事实源）。
// 框架无关：浏览器 <script src> 挂到全局 NavioProto，Node 用 require() 引入。
// 传输层由调用方注入：{ send(frame63B), receive(timeoutMs) -> Promise<Uint8Array(63)> }。
(function (root, factory) {
  const api = factory();
  root.NavioProto = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const MAGIC = 0x4e;
  const FRAME_SIZE = 63; // 线上为 Report ID 6 + 63B；ID 不属于帧
  const FRAME_PAYLOAD_MAX = 58;
  const BODY_MAX = 2048;
  const FRAGMENT_MAX = 36;
  const SMALL_RESPONSE_MAX = 51; // 58 - 4B 消息头 - 3B ACK 头
  const CHUNK_DATA_MAX = 55; // 58 - 3B ACK 头（READ_CHUNK 响应无消息头）
  const CHUNK_MAX = 38; // ceil(2048 / 55)

  const CMD = {
    HELLO: 0x01, GET_INFO: 0x02, GET_PRESETS: 0x03, WRITE_PRESET: 0x04,
    DELETE: 0x05, MOVE: 0x06, LED_PREVIEW: 0x07, READ_PRESET: 0x08,
    READ_CHUNK: 0x09, ACK: 0x40, ERR: 0x41,
  };
  const STATUS = { OK: 0, CHUNK: 1, MORE: 2 };
  const ERR = {
    NONE: 0, BAD_MAGIC: 1, NOT_IMPLEMENTED: 2, BAD_SEQ: 3, OVERFLOW: 4,
    CHECKSUM: 5, BAD_TOTAL: 6, TIMEOUT: 7, BAD_STATE: 8, BAD_PAYLOAD: 9,
    NVS_FAILURE: 10, UNSUPPORTED_VERSION: 11,
  };

  function crc8(bytes) { // CRC-8/SMBUS poly 0x07 init 0x00；"123456789" -> 0xF4
    let crc = 0;
    for (const value of bytes) {
      crc ^= value;
      for (let bit = 0; bit < 8; ++bit)
        crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
    return crc;
  }

  function crc16(bytes) { // CRC-16/CCITT-FALSE poly 0x1021 init 0xFFFF；"123456789" -> 0x29B1
    let crc = 0xffff;
    for (const value of bytes) {
      crc ^= value << 8;
      for (let bit = 0; bit < 8; ++bit)
        crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc;
  }

  function le16(value) { return [value & 0xff, (value >> 8) & 0xff]; }
  function u16(bytes, offset = 0) { return bytes[offset] | (bytes[offset + 1] << 8); }
  function concat(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  // 普通消息 = 4B 头（bodyLength + bodyCrc16）+ 正文，跨片拼接
  function messageStream(body) {
    return concat(new Uint8Array(le16(body.length)), new Uint8Array(le16(crc16(body))), body);
  }
  function fragmentCount(bodyLength) { return Math.ceil((4 + bodyLength) / FRAME_PAYLOAD_MAX); }
  function chunkCount(dataLength) { return Math.ceil(dataLength / CHUNK_DATA_MAX); }

  // payload 为该片携带的消息流切片（≤58B），末片补零由帧缓冲天然完成
  function encodeFrame(cmd, seq, total, payload) {
    if (payload.length > FRAME_PAYLOAD_MAX) throw new Error("payload > 58B");
    const frame = new Uint8Array(FRAME_SIZE);
    frame.set([MAGIC, cmd, seq, total], 0);
    frame.set(payload, 4);
    frame[62] = crc8(frame.subarray(0, 62));
    return frame;
  }

  function encodeRequest(cmd, body = new Uint8Array()) {
    if (body.length > BODY_MAX) throw new Error("body > BODY_MAX");
    const total = fragmentCount(body.length);
    if (total > FRAGMENT_MAX) throw new Error("total > FRAGMENT_MAX");
    const stream = messageStream(body);
    const frames = [];
    for (let seq = 0; seq < total; ++seq)
      frames.push(encodeFrame(cmd, seq, total, stream.subarray(seq * 58, seq * 58 + 58)));
    return frames;
  }

  class ProtoError extends Error {
    constructor(code, detail, echoCmd, seq) {
      super(`ERR ${code} (detail=${detail}, cmd=${echoCmd}, seq=${seq})`);
      this.code = code; this.detail = detail; this.echoCmd = echoCmd; this.seq = seq;
    }
  }
  class TimeoutError extends Error {
    constructor(message = "HID response timeout") { super(message); this.name = "TimeoutError"; }
  }

  function checkFrame(frame) {
    if (frame.length !== FRAME_SIZE) throw new Error(`Bad frame length: ${frame.length}`);
    if (crc8(frame.subarray(0, 62)) !== frame[62]) throw new Error("Response CRC8 mismatch");
    if (frame[0] !== MAGIC) throw new Error("Response magic mismatch");
  }

  // ACK/ERR 为单片普通消息：4B 消息头 + 正文（ACK ≥3B，ERR =4B）
  function parseAckErr(frame) {
    checkFrame(frame);
    const bodyLength = u16(frame, 4);
    if (bodyLength > FRAME_PAYLOAD_MAX - 4) throw new Error("Bad response bodyLength");
    const body = frame.subarray(8, 8 + bodyLength);
    if (crc16(body) !== u16(frame, 6)) throw new Error("Response body CRC16 mismatch");
    if (frame[1] === CMD.ERR) {
      if (body.length !== 4) throw new Error("Malformed ERR");
      throw new ProtoError(body[2], body[3], body[0], body[1]);
    }
    if (frame[1] !== CMD.ACK || body.length < 3) throw new Error("Malformed ACK");
    return { echo: body[0], seq: body[1], status: body[2], data: body.slice(3) };
  }

  // READ_CHUNK 数据片：无 4B 消息头，正文 = [READ_CHUNK][chunkSeq][CHUNK][≤55B data]
  function parseChunk(frame, expectedSeq) {
    checkFrame(frame);
    if (frame[1] === CMD.ERR) parseAckErr(frame); // 走统一 ERR 解析并抛出
    if (frame[1] !== CMD.ACK || frame[4] !== CMD.READ_CHUNK ||
        frame[5] !== expectedSeq || frame[6] !== STATUS.CHUNK)
      throw new Error("Malformed READ_CHUNK response");
    return { seq: frame[2], total: frame[3], data: frame.slice(7, 62) };
  }

  // 逐片 stop-and-wait 会话：同一方向同一时间一个事务（PROTOCOL.md §7/§8/§9）
  class Session {
    constructor(transport, { timeoutMs = 1000, maxRetries = 3 } = {}) {
      this.transport = transport;
      this.timeoutMs = timeoutMs;
      this.maxRetries = maxRetries;
    }

    matchesResponse_(response, request) {
      if (response[1] !== CMD.ACK && response[1] !== CMD.ERR) return false;
      if (request[1] === CMD.READ_CHUNK) {
        if (response[1] === CMD.ACK)
          return response[4] === CMD.READ_CHUNK && response[5] === request[8];
        return response[8] === CMD.READ_CHUNK && response[9] === request[2];
      }
      return response[8] === request[1] && response[9] === request[2];
    }

    async exchange(frame, { timeoutMs = this.timeoutMs, maxRetries = this.maxRetries } = {}) {
      // 发送一片并等待响应，超时按 §7.7 重发同一片；丢弃上一片的迟到重复响应
      let attempt = 0;
      for (;;) {
        await this.transport.send(frame);
        const deadline = performance.now() + timeoutMs;
        try {
          for (;;) {
            const remaining = deadline - performance.now();
            if (remaining <= 0) throw new TimeoutError();
            const response = await this.transport.receive(remaining);
            checkFrame(response);
            if (this.matchesResponse_(response, frame)) return response;
          }
        } catch (error) {
          if (!(error instanceof TimeoutError) || ++attempt > maxRetries) throw error;
        }
      }
    }

    async request(cmd, body = new Uint8Array(), options = {}) {
      const frames = encodeRequest(cmd, body);
      for (let seq = 0; seq < frames.length; ++seq) {
        const ack = parseAckErr(await this.exchange(frames[seq], options));
        if (ack.echo !== cmd || ack.seq !== seq) throw new Error("ACK identity mismatch");
        if (seq + 1 < frames.length) {
          if (ack.status !== STATUS.CHUNK) throw new Error(`Expected CHUNK, got ${ack.status}`);
        } else if (ack.status === STATUS.OK) {
          return ack.data;
        } else if (ack.status === STATUS.MORE) {
          return this.readLarge(ack.data);
        } else {
          throw new Error(`Unexpected final status ${ack.status}`);
        }
      }
      throw new Error("unreachable");
    }

    async readLarge(metadata) {
      if (metadata.length !== 4) throw new Error("Malformed MORE metadata");
      const length = u16(metadata, 0), expectedCrc = u16(metadata, 2);
      const total = chunkCount(length);
      if (total > CHUNK_MAX) throw new Error("chunkTotal > 38");
      const parts = [];
      for (let seq = 0; seq < total; ++seq) {
        const request = encodeRequest(CMD.READ_CHUNK, new Uint8Array([seq]))[0];
        const chunk = parseChunk(await this.exchange(request), seq);
        if (chunk.seq !== seq || chunk.total !== total) throw new Error("Chunk sequence mismatch");
        parts.push(chunk.data);
      }
      const body = concat(...parts).slice(0, length);
      if (crc16(body) !== expectedCrc) throw new Error("Large response CRC16 mismatch");
      return body;
    }
  }

  return {
    MAGIC, FRAME_SIZE, FRAME_PAYLOAD_MAX, BODY_MAX, FRAGMENT_MAX,
    SMALL_RESPONSE_MAX, CHUNK_DATA_MAX, CHUNK_MAX, CMD, STATUS, ERR,
    crc8, crc16, le16, u16, concat, messageStream, fragmentCount, chunkCount,
    encodeFrame, encodeRequest, parseAckErr, parseChunk,
    ProtoError, TimeoutError, Session,
  };
});
