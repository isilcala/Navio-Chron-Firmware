import json
import sys
import time

import hid

VID = 0xCAFE
PID = 0xBEEF
REPORT_ID = 6
FRAME_SIZE = 63
BODY_MAX = 2048
MAGIC = 0x4E
ACK = 0x40
ERR = 0x41
HELLO = 0x01
GET_INFO = 0x02
GET_PRESETS = 0x03
WRITE_PRESET = 0x04
READ_CHUNK = 0x09
OK = 0
CHUNK = 1
MORE = 2


def crc8(data):
    crc = 0
    for value in data:
        crc ^= value
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc


def crc16(data):
    crc = 0xFFFF
    for value in data:
        crc ^= value << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def le16(value):
    return bytes((value & 0xFF, value >> 8))


def u16(data):
    return data[0] | data[1] << 8


def fragment_count(body_length):
    return (4 + body_length + 57) // 58


def message_stream(body, body_length=None, body_crc=None):
    """普通消息流 = 4B 头 + 正文；伪造帧可显式覆盖头字段。"""
    if body_length is None:
        body_length = len(body)
    if body_crc is None:
        body_crc = crc16(body)
    return le16(body_length) + le16(body_crc) + body


def make_frame(cmd, seq, total, payload=b""):
    """payload 为该片携带的消息流切片（≤58B），末片补零由帧缓冲天然完成。"""
    assert len(payload) <= 58
    frame = bytearray(FRAME_SIZE)
    frame[:4] = bytes((MAGIC, cmd, seq, total))
    frame[4:4 + len(payload)] = payload
    frame[62] = crc8(frame[:62])
    return bytes(frame)


class ProtoError(Exception):
    def __init__(self, code, detail, echo_cmd, seq):
        super().__init__(f"ERR {code} (detail={detail}, cmd={echo_cmd}, seq={seq})")
        self.code = code
        self.detail = detail
        self.echo_cmd = echo_cmd
        self.seq = seq


class Navio:
    def __init__(self):
        deadline = time.time() + 20
        matches = []
        while not matches and time.time() < deadline:
            matches = [
                d for d in hid.enumerate(VID, PID)
                if d["usage_page"] >= 0xFF00 and d["usage"] == 1
            ]
            if not matches:
                time.sleep(0.2)
        if not matches:
            raise RuntimeError("No Vendor HID interface found")
        self.device = hid.device()
        self.device.open_path(matches[0]["path"])
        self.device.set_nonblocking(False)

    def close(self):
        self.device.close()

    def send(self, frame):
        assert len(frame) == FRAME_SIZE
        written = self.device.write(bytes([REPORT_ID]) + frame)
        if written != FRAME_SIZE + 1:
            raise RuntimeError(f"Short HID write: {written}")

    def read_frame(self, timeout=1.0):
        response = self.device.read(FRAME_SIZE + 1, int(timeout * 1000))
        if not response:
            raise TimeoutError("HID response timeout")
        if len(response) == FRAME_SIZE + 1 and response[0] == REPORT_ID:
            response = response[1:]
        if len(response) != FRAME_SIZE:
            raise RuntimeError(f"Bad response length: {len(response)}")
        frame = bytes(response)
        if crc8(frame[:62]) != frame[62]:
            raise RuntimeError("Response CRC8 mismatch")
        if frame[0] != MAGIC:
            raise RuntimeError("Response magic mismatch")
        return frame

    def read_ack(self):
        frame = self.read_frame()
        body_length = u16(frame[4:6])
        if body_length > 54 or crc16(frame[8:8 + body_length]) != u16(frame[6:8]):
            raise RuntimeError("Response message header/CRC mismatch")
        body = frame[8:8 + body_length]
        if frame[1] == ERR:
            if len(body) != 4:
                raise RuntimeError("Malformed ERR")
            raise ProtoError(body[2], body[3], body[0], body[1])
        if frame[1] != ACK or len(body) < 3:
            raise RuntimeError("Malformed ACK")
        return body[0], body[1], body[2], body[3:]

    def start(self, cmd, body=b""):
        total = fragment_count(len(body))
        stream = message_stream(body)
        for seq in range(total):
            part = stream[58 * seq:58 * seq + 58]
            self.send(make_frame(cmd, seq, total, part))
            echo, ack_seq, status, data = self.read_ack()
            if echo != cmd or ack_seq != seq:
                raise RuntimeError("ACK identity mismatch")
            if seq + 1 < total:
                if status != CHUNK:
                    raise RuntimeError(f"Expected CHUNK, got {status}")
            elif status == OK:
                return OK, data
            elif status == MORE:
                return MORE, data
            else:
                raise RuntimeError(f"Unexpected final status {status}")
        raise AssertionError("unreachable")

    def read_chunk(self, seq):
        self.send(make_frame(READ_CHUNK, 0, 1, message_stream(bytes([seq]))))
        frame = self.read_frame()
        if frame[1] == ERR:
            body_length = u16(frame[4:6])
            body = frame[8:8 + body_length]
            if len(body) != 4 or crc16(body) != u16(frame[6:8]):
                raise RuntimeError("Malformed ERR")
            raise ProtoError(body[2], body[3], body[0], body[1])
        if frame[1] != ACK or frame[4] != READ_CHUNK or frame[5] != seq or frame[6] != CHUNK:
            raise RuntimeError("Malformed READ_CHUNK response")
        return frame[2], frame[3], frame[7:62]

    def read_large(self, metadata):
        if len(metadata) != 4:
            raise RuntimeError("Malformed MORE metadata")
        length = u16(metadata[:2])
        expected_crc = u16(metadata[2:])
        total = (length + 54) // 55
        body = bytearray()
        for seq in range(total):
            frame_seq, frame_total, part = self.read_chunk(seq)
            if frame_seq != seq or frame_total != total:
                raise RuntimeError("Chunk sequence mismatch")
            body.extend(part)
        body = bytes(body[:length])
        if crc16(body) != expected_crc:
            raise RuntimeError("Large response CRC16 mismatch")
        return body

    def request(self, cmd, body=b""):
        status, data = self.start(cmd, body)
        return self.read_large(data) if status == MORE else data


def expect_error(code, fn, detail=None):
    try:
        fn()
    except ProtoError as error:
        assert error.code == code, (error.code, code)
        if detail is not None:
            assert error.detail == detail, (error.detail, detail)
        print(f"PASS expected ERR {code}")
        return
    raise AssertionError(f"Expected ERR {code}")


def run_smoke(navio):
    hello = json.loads(navio.request(HELLO))
    assert hello["proto"] == 2 and hello["name"] == "Navio Chron"
    print("PASS HELLO", hello)
    info = json.loads(navio.request(GET_INFO))
    assert info == {
        "record": 1,
        "maxBody": BODY_MAX,
        "maxPresets": 6,
        "cmds": [1, 2, 3, 4, 5, 6, 7, 8, 9],
    }
    print("PASS GET_INFO + READ_CHUNK", info)
    return hello, info


def run_faults(navio):
    frame = bytearray(make_frame(GET_INFO, 0, 1))
    frame[0] = 0
    frame[62] = crc8(frame[:62])
    expect_error(1, lambda: (navio.send(frame), navio.read_ack())[1])
    print("PASS bad magic")

    frame = bytearray(make_frame(GET_INFO, 0, 1))
    frame[62] ^= 1
    navio.send(frame)
    try:
        navio.read_frame(0.2)
    except TimeoutError:
        print("PASS bad CRC8 is silent")
    else:
        raise AssertionError("Bad CRC8 received a response")
    navio.request(HELLO)
    print("PASS recovery after bad CRC8")

    frame = make_frame(GET_INFO, 0, 2)
    expect_error(6, lambda: (navio.send(frame), navio.read_ack())[1])
    print("PASS bad total")

    frame = make_frame(GET_INFO, 0, 36, message_stream(b"", body_length=2049, body_crc=0))
    expect_error(4, lambda: (navio.send(frame), navio.read_ack())[1])
    print("PASS oversized body")

    frame = make_frame(GET_PRESETS, 1, 1)
    expect_error(8, lambda: (navio.send(frame), navio.read_ack())[1])
    print("PASS non-active continuation")

    body = bytes(range(60))
    stream = message_stream(body, body_crc=crc16(body) ^ 1)
    navio.send(make_frame(WRITE_PRESET, 0, 2, stream[:58]))
    echo, seq, status, _ = navio.read_ack()
    assert (echo, seq, status) == (WRITE_PRESET, 0, CHUNK)
    frame = make_frame(WRITE_PRESET, 1, 2, stream[58:])
    expect_error(5, lambda: (navio.send(frame), navio.read_ack())[1])
    print("PASS multi-frame CRC16 failure")

    stream = le16(len(body)) + le16(crc16(body)) + body
    navio.send(make_frame(WRITE_PRESET, 0, 2, stream[:58]))
    navio.read_ack()
    frame = make_frame(WRITE_PRESET, 2, 2, stream[58:])
    expect_error(3, lambda: (navio.send(frame), navio.read_ack())[1], detail=1)
    print("PASS out-of-order sequence")
    navio.request(HELLO)
    expect_error(8, lambda: (navio.send(frame), navio.read_ack())[1])
    print("PASS seq=0 cancels old transaction")

    navio.send(make_frame(WRITE_PRESET, 0, 2, stream[:58]))
    navio.read_ack()
    time.sleep(3.2)
    frame = make_frame(WRITE_PRESET, 1, 2, stream[58:])
    expect_error(8, lambda: (navio.send(frame), navio.read_ack())[1])
    print("PASS device idle timeout")

    status, metadata = navio.start(GET_INFO)
    assert status == MORE
    length = u16(metadata[:2])
    total = (length + 54) // 55
    seq, chunk_total, first = navio.read_chunk(0)
    assert seq == 0 and chunk_total == total
    seq, _, duplicate = navio.read_chunk(0)
    assert seq == 0 and duplicate == first
    expect_error(3, lambda: navio.read_chunk(2), detail=1)
    print("PASS duplicate and out-of-order READ_CHUNK")

    body = bytearray(first)
    for chunk_seq in range(1, total):
        seq, chunk_total, part = navio.read_chunk(chunk_seq)
        assert seq == chunk_seq and chunk_total == total
        body.extend(part)
    body = bytes(body[:length])
    assert crc16(body) == u16(metadata[2:])
    assert json.loads(body)["maxBody"] == BODY_MAX
    print("PASS large response reassembly after faults")


def main():
    assert crc8(b"123456789") == 0xF4
    assert crc16(b"123456789") == 0x29B1
    print("PASS CRC reference vectors")
    navio = Navio()
    try:
        run_smoke(navio)
        if len(sys.argv) > 1 and sys.argv[1] == "fault":
            run_faults(navio)
    finally:
        navio.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
