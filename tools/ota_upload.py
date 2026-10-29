import argparse
import hashlib
import struct
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "probe"))

from hid_probe import (GET_INFO, GET_PRESETS, HELLO, Navio, OTA_BEGIN,
                       OTA_BLOCK_MAX, OTA_CONFIRM, OTA_FINISH, OTA_LONG_TIMEOUT,
                       OTA_REBOOT, OTA_WRITE, ota_status)

BLOCK_MAX = OTA_BLOCK_MAX
LONG_TIMEOUT = OTA_LONG_TIMEOUT


def main():
    parser = argparse.ArgumentParser(description="Upgrade Navio Chron over Vendor HID OTA")
    parser.add_argument("firmware", nargs="?", default=".pio/build/navio_chron/firmware.bin")
    parser.add_argument("--status", action="store_true", help="only query OTA status")
    args = parser.parse_args()

    navio = Navio()
    try:
        import json
        hello = json.loads(navio.request(HELLO))
        current = ota_status(navio)
        print("HELLO", hello)
        print("STATUS", current)
        if args.status:
            return 0

        if current["session"] == 2:
            navio.request(OTA_REBOOT)
            navio.close()
            navio = None
            time.sleep(1.0)
            navio = Navio()
            current = ota_status(navio)
            print("RECOVERED READY_TO_REBOOT", current)

        firmware = Path(args.firmware).read_bytes()
        if not firmware:
            raise RuntimeError("Empty firmware image")
        if current["session"] != 0:
            raise RuntimeError("OTA session is already active; abort or reboot first")
        if current["image_state"] == 2:
            raise RuntimeError("Running image is PENDING_VERIFY; confirm it before another OTA")
        info = json.loads(navio.request(GET_INFO))
        required = set(range(10, 17))
        if not required.issubset(set(info["cmds"])):
            raise RuntimeError("Device does not advertise the complete OTA command set")
        before_presets = navio.request(GET_PRESETS)

        digest = hashlib.sha256(firmware).digest()
        started = time.monotonic()
        begin_started = time.monotonic()
        response = navio.request(OTA_BEGIN, struct.pack("<I", len(firmware)) + digest,
                                 timeout=LONG_TIMEOUT, max_retries=2)
        if len(response) != 4 or response[3] != 0:
            raise RuntimeError("Malformed OTA_BEGIN response")
        target = response[0]
        max_block = struct.unpack_from("<H", response, 1)[0]
        if target not in (0, 1) or max_block != BLOCK_MAX:
            raise RuntimeError(f"Unexpected OTA_BEGIN capabilities: {response.hex()}")
        print(f"BEGIN target=app{target} size={len(firmware)} "
              f"time={time.monotonic() - begin_started:.2f}s")

        total = (len(firmware) + BLOCK_MAX - 1) // BLOCK_MAX
        report_every = max(1, total // 20)
        for block, offset in enumerate(range(0, len(firmware), BLOCK_MAX), 1):
            chunk = firmware[offset:offset + BLOCK_MAX]
            response = navio.request(OTA_WRITE, struct.pack("<I", offset) + chunk)
            if len(response) != 4 or struct.unpack("<I", response)[0] != offset + len(chunk):
                raise RuntimeError(f"OTA_WRITE offset mismatch at {offset}")
            if block % report_every == 0 or block == total:
                print(f"WRITE {offset + len(chunk)}/{len(firmware)} "
                      f"({100 * (offset + len(chunk)) // len(firmware)}%)")

        finish_started = time.monotonic()
        response = navio.request(OTA_FINISH, timeout=LONG_TIMEOUT, max_retries=2)
        if response != bytes([target]):
            raise RuntimeError("Malformed OTA_FINISH response")
        print(f"FINISH time={time.monotonic() - finish_started:.2f}s")

        navio.request(OTA_REBOOT)
        navio.close()
        navio = None
        print("REBOOT waiting for enumeration")
        time.sleep(1.0)
        navio = Navio()
        hello = json.loads(navio.request(HELLO))
        updated = ota_status(navio)
        print("HELLO after OTA", hello)
        print("STATUS after OTA", updated)
        if updated["running_slot"] != target:
            raise RuntimeError("Booted slot does not match OTA target")
        if updated["image_state"] not in (1, 2):
            raise RuntimeError("New image is not valid or pending verification")
        if navio.request(GET_PRESETS) != before_presets:
            raise RuntimeError("Preset manifest changed during OTA")

        response = navio.request(OTA_CONFIRM)
        if response != b"\x01":
            raise RuntimeError("Malformed OTA_CONFIRM response")
        print(f"CONFIRM app{target} VALID; total={time.monotonic() - started:.2f}s")
        return 0
    finally:
        if navio is not None:
            navio.close()


if __name__ == "__main__":
    raise SystemExit(main())
