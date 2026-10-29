import hashlib
import struct
import sys
import time
from pathlib import Path

from hid_probe import (CHUNK, GET_INFO, Navio, OTA_ABORT, OTA_BEGIN,
                       OTA_FINISH, OTA_LONG_TIMEOUT, OTA_WRITE, expect_error,
                       make_frame, message_stream, ota_status)

MOVE = 0x06
LONG_TIMEOUT = OTA_LONG_TIMEOUT


def begin(navio, firmware, digest=None):
    if digest is None:
        digest = hashlib.sha256(firmware).digest()
    response = navio.request(OTA_BEGIN, struct.pack("<I", len(firmware)) + digest,
                             timeout=LONG_TIMEOUT, max_retries=2)
    assert len(response) == 4 and response[0] in (0, 1)
    assert struct.unpack_from("<H", response, 1)[0] == 2044 and response[3] == 0
    return response[0]


def main():
    firmware = Path(".pio/build/navio_chron/firmware.bin").read_bytes()
    navio = Navio()
    try:
        initial = ota_status(navio)
        print("PASS initial status", initial)
        if initial["session"] == 1:
            navio.request(OTA_ABORT)
        initial = ota_status(navio)
        assert initial["session"] == 0 and initial["image_state"] != 2

        begin(navio, firmware)
        assert ota_status(navio)["session"] == 1
        info = navio.request(GET_INFO)
        assert set(range(10, 17)).issubset(set(__import__("json").loads(info)["cmds"]))
        print("PASS BEGIN and GET_INFO/READ_CHUNK during RECEIVING")

        expect_error(3, lambda: navio.request(OTA_WRITE, struct.pack("<I", 1) + b"x"))
        assert ota_status(navio)["received"] == 0
        expect_error(9, lambda: navio.request(OTA_WRITE, struct.pack("<I", 0)))
        expect_error(8, lambda: navio.request(OTA_FINISH))
        expect_error(8, lambda: navio.request(MOVE, bytes([1, 0])))
        print("PASS wrong offset, empty block, premature FINISH and blocked preset mutation")

        navio.request(OTA_ABORT)
        navio.request(OTA_ABORT)
        assert ota_status(navio)["session"] == 0
        print("PASS ABORT is idempotent and restores IDLE")

        invalid = bytes(64)
        begin(navio, invalid)
        stream = message_stream(struct.pack("<I", 0) + invalid)
        navio.send(make_frame(OTA_WRITE, 0, 2, stream[:58]))
        echo, seq, chunk_status, _ = navio.read_ack()
        assert (echo, seq, chunk_status) == (OTA_WRITE, 0, CHUNK)
        final_frame = make_frame(OTA_WRITE, 1, 2, stream[58:])
        navio.send(final_frame)
        time.sleep(0.05)
        navio.send(final_frame)
        error = navio.read_frame()
        duplicate = navio.read_frame()
        assert duplicate == error and error[10] == 13 and error[11] == 13
        failed = ota_status(navio)
        assert failed["session"] == 0 and failed["update_error"] == 13
        navio.request(OTA_ABORT)
        assert ota_status(navio)["update_error"] == 13
        print("PASS invalid image, error detail replay and updateError preservation")

        if len(sys.argv) > 1 and sys.argv[1] == "hash":
            begin(navio, firmware, hashlib.sha256(firmware + b"x").digest())
            for offset in range(0, len(firmware), 2044):
                chunk = firmware[offset:offset + 2044]
                response = navio.request(OTA_WRITE, struct.pack("<I", offset) + chunk)
                assert struct.unpack("<I", response)[0] == offset + len(chunk)
            expect_error(5, lambda: navio.request(OTA_FINISH, timeout=LONG_TIMEOUT, max_retries=2))
            failed = ota_status(navio)
            assert failed["session"] == 0 and failed["update_error"] == 15
            assert failed["running_slot"] == initial["running_slot"]
            print("PASS full image SHA-256 mismatch does not activate")

        if len(sys.argv) > 1 and sys.argv[1] == "timeout":
            begin(navio, firmware)
            time.sleep(30.5)
            assert ota_status(navio)["session"] == 0
            print("PASS 30s receive-session timeout")
        return 0
    finally:
        try:
            if ota_status(navio)["session"] == 1:
                navio.request(OTA_ABORT)
        except Exception:
            pass
        navio.close()


if __name__ == "__main__":
    raise SystemExit(main())
