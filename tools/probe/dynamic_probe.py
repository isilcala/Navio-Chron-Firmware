from hid_probe import GET_PRESETS, Navio, WRITE_PRESET, expect_error
from preset_record import make_record, record_crc_valid, record_name, set_action

DELETE = 0x05
MOVE = 0x06
CMD_READ_PRESET = 0x08


def manifest(navio):
    data = navio.request(GET_PRESETS)
    result = []
    offset = 2
    for _ in range(data[0]):
        preset_id = data[offset]
        name_len = data[offset + 1]
        start = offset + 2
        name = data[start:start + name_len].decode("utf-8")
        result.append((preset_id, name))
        offset = start + name_len
    assert offset == len(data)
    return result


def active_id(navio):
    return navio.request(GET_PRESETS)[1]


def backup(navio, entries):
    return {preset_id: navio.request(CMD_READ_PRESET, bytes([preset_id]))
            for preset_id, _ in entries}


def expect_proto_error(code, fn):
    expect_error(code, fn)


def main():
    navio = Navio()
    original = []
    backups = {}
    temporary_ids = set()
    try:
        original = manifest(navio)
        original_active = active_id(navio)
        backups = backup(navio, original)
        print("PASS initial manifest", original)

        record = bytearray(make_record(10, "Host Test"))
        set_action(record, 0, 1, code=0x04)
        set_action(record, 1, 1, mods=1, code=0x05)
        assert record_crc_valid(record)
        navio.request(WRITE_PRESET, record)
        temporary_ids.add(10)
        assert navio.request(CMD_READ_PRESET, bytes([10])) == bytes(record)
        assert manifest(navio) == original + [(10, "Host Test")]
        assert active_id(navio) == original_active
        print("PASS WRITE_PRESET + READ_PRESET byte identity and activeId response")

        first_id = original[0][0]
        navio.request(MOVE, bytes([10, first_id]))
        assert manifest(navio)[0] == (10, "Host Test")
        navio.request(MOVE, bytes([10, 0]))
        assert manifest(navio) == original + [(10, "Host Test")]
        print("PASS MOVE before ID and move to end")

        before = manifest(navio)
        bad = bytearray(record)
        bad[0] = 0
        expect_proto_error(9, lambda: navio.request(WRITE_PRESET, bad))
        bad = bytearray(record)
        bad[2] = 2
        from hid_probe import crc16, le16
        bad[148:150] = le16(crc16(bad[:148]))
        expect_proto_error(11, lambda: navio.request(WRITE_PRESET, bad))
        assert manifest(navio) == before
        print("PASS invalid and unsupported records preserve manifest")

        expect_proto_error(9, lambda: navio.request(DELETE, bytes([250])))
        print("PASS DELETE unknown ID rejected")

        next_id = 20
        while len(manifest(navio)) < 6:
            extra = make_record(next_id, f"Extra {next_id}")
            navio.request(WRITE_PRESET, extra)
            temporary_ids.add(next_id)
            next_id += 1
        expect_proto_error(4, lambda: navio.request(WRITE_PRESET, make_record(next_id, "Overflow")))
        print("PASS seventh new preset rejected")

        for preset_id in sorted(temporary_ids):
            navio.request(DELETE, bytes([preset_id]))
        temporary_ids.clear()
        assert manifest(navio) == original
        print("PASS cleanup and manifest restoration")

        for preset_id, _ in original[:-1]:
            navio.request(DELETE, bytes([preset_id]))
        last_id = original[-1][0]
        expect_proto_error(8, lambda: navio.request(DELETE, bytes([last_id])))
        assert len(manifest(navio)) == 1
        print("PASS deleting last preset rejected")

        for preset_id, data in backups.items():
            if preset_id != last_id:
                navio.request(WRITE_PRESET, data)
        navio.request(MOVE, bytes([last_id, 0]))
        assert manifest(navio) == original
        print("PASS original presets restored")
    finally:
        for preset_id in sorted(temporary_ids):
            try:
                navio.request(DELETE, bytes([preset_id]))
            except Exception:
                pass
        try:
            current_ids = {preset_id for preset_id, _ in manifest(navio)}
            for preset_id, data in backups.items():
                if preset_id not in current_ids:
                    navio.request(WRITE_PRESET, data)
        except Exception:
            pass
        navio.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
