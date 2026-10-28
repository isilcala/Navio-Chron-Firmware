from hid_probe import crc16, le16, u16

RECORD_SIZE = 150
NAME_MAX = 24
ACTION_OFFSET = 38
ACTION_SIZE = 5
BTN_COUNT = 16
ENC_COUNT = 3


def make_record(preset_id, name, accent=(0, 80, 40)):
    encoded_name = name.encode("utf-8")
    assert 1 <= preset_id <= 255
    assert 1 <= len(encoded_name) < NAME_MAX
    assert len(accent) == 3
    record = bytearray(RECORD_SIZE)
    record[:2] = b"NP"
    record[2] = 1
    record[4:6] = le16(RECORD_SIZE)
    record[6] = preset_id
    record[7] = len(encoded_name)
    record[8:11] = bytes(accent)
    record[14:14 + len(encoded_name)] = encoded_name
    record[148:150] = le16(crc16(record[:148]))
    return bytes(record)


def set_action(record, index, kind, mods=0, code=0, wheel=0):
    assert 0 <= index < BTN_COUNT + ENC_COUNT * 2
    assert len(record) == RECORD_SIZE
    offset = ACTION_OFFSET + index * ACTION_SIZE
    record[offset:offset + ACTION_SIZE] = bytes(
        (kind, mods, code & 0xFF, code >> 8, wheel & 0xFF)
    )
    record[148:150] = le16(crc16(record[:148]))


def record_id(record):
    assert len(record) == RECORD_SIZE
    return record[6]


def record_name(record):
    length = record[7]
    return record[14:14 + length].decode("utf-8")


def record_crc_valid(record):
    return len(record) == RECORD_SIZE and crc16(record[:148]) == u16(record[148:150])
