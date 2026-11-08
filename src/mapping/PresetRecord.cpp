#include "mapping/PresetRecord.h"

#include "ByteOrder.h"
#include "proto/Crc.h"

namespace navio {

namespace {

constexpr size_t ACTION_OFFSET = 38;
constexpr size_t ACTION_SIZE = 5;
constexpr size_t ACTION_COUNT = BTN_COUNT + ENC_COUNT * 2;
constexpr size_t CRC_OFFSET = 148;
static_assert(ACTION_OFFSET + ACTION_COUNT * ACTION_SIZE == CRC_OFFSET);

bool validUtf8(const uint8_t* data, size_t len) {
  size_t i = 0;
  while (i < len) {
    uint8_t a = data[i++];
    if (a == 0) return false;
    if (a < 0x80) continue;
    if (a < 0xC2) return false;
    if (a <= 0xDF) {
      if (i >= len || (data[i++] & 0xC0) != 0x80) return false;
      continue;
    }
    if (a <= 0xEF) {
      if (i + 1 >= len) return false;
      uint8_t b = data[i++];
      uint8_t c = data[i++];
      if ((b & 0xC0) != 0x80 || (c & 0xC0) != 0x80) return false;
      if (a == 0xE0 && b < 0xA0) return false;
      if (a == 0xED && b >= 0xA0) return false;
      continue;
    }
    if (a > 0xF4 || a < 0xF0 || i + 2 >= len) return false;
    uint8_t b = data[i++];
    uint8_t c = data[i++];
    uint8_t d = data[i++];
    if ((b & 0xC0) != 0x80 || (c & 0xC0) != 0x80 || (d & 0xC0) != 0x80) return false;
    if (a == 0xF0 && b < 0x90) return false;
    if (a == 0xF4 && b >= 0x90) return false;
  }
  return true;
}

bool decodeAction(const uint8_t* data, Action& action, bool button) {
  uint8_t kind = data[0];
  uint8_t mods = data[1];
  uint16_t code = readLe16(data + 2);
  int8_t wheelDy = static_cast<int8_t>(data[4]);
  bool valid = false;
  if (kind == Action::None) {
    valid = mods == 0 && code == 0 && wheelDy == 0;
  } else if (kind == Action::KeyChord) {
    valid = code <= 0xE7 && wheelDy == 0 && (code != 0 || mods != 0);
  } else if (kind == Action::Consumer) {
    valid = code >= 1 && code <= 0x03FF && mods == 0 && wheelDy == 0;
  } else if (kind == Action::Wheel) {
    valid = !button && code == 0 && wheelDy != 0;
  }
  if (!valid) return false;
  action.kind = static_cast<Action::Kind>(kind);
  action.mods = mods;
  action.code = code;
  action.wheelDy = wheelDy;
  return true;
}

void encodeAction(const Action& action, uint8_t* out) {
  out[0] = action.kind;
  out[1] = action.mods;
  writeLe16(out + 2, action.code);
  out[4] = static_cast<uint8_t>(action.wheelDy);
}

}  // namespace

PresetRecordResult decodePresetRecord(const uint8_t* data, size_t len, InstalledPreset& out) {
  if (!data || len != PRESET_RECORD_SIZE) return PresetRecordResult::Invalid;
  if (data[0] != 'N' || data[1] != 'P') return PresetRecordResult::Invalid;
  if (data[2] != 1) return PresetRecordResult::UnsupportedVersion;
  // byte 11 = rgbMode（1=reactive 默认，0=off，2..9 见 D30）、byte 12 = 保留 0；
  // byte 13 = 平台元数据（0=win/1=mac/2=iPad，D24）：固件不据此分支，仅原样存取。
  if (data[3] != 0 || readLe16(data + 4) != PRESET_RECORD_SIZE || data[6] == 0 ||
      data[11] > 9 || data[12] != 0 ||
      crc16(data, CRC_OFFSET) != readLe16(data + CRC_OFFSET)) {
    return PresetRecordResult::Invalid;
  }

  uint8_t nameLength = data[7];
  if (nameLength == 0 || nameLength >= PRESET_NAME_MAX ||
      !validUtf8(data + 14, nameLength)) {
    return PresetRecordResult::Invalid;
  }
  for (size_t i = 14 + nameLength; i < ACTION_OFFSET; ++i) {
    if (data[i] != 0) return PresetRecordResult::Invalid;
  }

  InstalledPreset decoded = {};
  decoded.id = data[6];
  decoded.platform = data[13];
  memcpy(decoded.name, data + 14, nameLength);
  decoded.name[nameLength] = 0;
  decoded.preset.name = decoded.name;
  memcpy(decoded.preset.accent, data + 8, 3);
  decoded.preset.rgbMode = data[11];

  for (size_t i = 0; i < BTN_COUNT; ++i) {
    if (!decodeAction(data + ACTION_OFFSET + i * ACTION_SIZE, decoded.preset.btn[i], true)) {
      return PresetRecordResult::Invalid;
    }
  }
  size_t offset = ACTION_OFFSET + BTN_COUNT * ACTION_SIZE;
  for (size_t enc = 0; enc < ENC_COUNT; ++enc) {
    for (size_t dir = 0; dir < 2; ++dir) {
      if (!decodeAction(data + offset, decoded.preset.enc[enc][dir], false)) {
        return PresetRecordResult::Invalid;
      }
      offset += ACTION_SIZE;
    }
  }

  out = decoded;
  out.preset.name = out.name;
  return PresetRecordResult::Ok;
}

void encodePresetRecord(const InstalledPreset& preset, uint8_t* out) {
  memset(out, 0, PRESET_RECORD_SIZE);
  out[0] = 'N';
  out[1] = 'P';
  out[2] = 1;
  writeLe16(out + 4, PRESET_RECORD_SIZE);
  out[6] = preset.id;
  out[11] = preset.preset.rgbMode;
  out[13] = preset.platform;
  size_t nameLength = strnlen(preset.name, PRESET_NAME_MAX - 1);
  out[7] = static_cast<uint8_t>(nameLength);
  memcpy(out + 8, preset.preset.accent, 3);
  memcpy(out + 14, preset.name, nameLength);
  for (size_t i = 0; i < BTN_COUNT; ++i) {
    encodeAction(preset.preset.btn[i], out + ACTION_OFFSET + i * ACTION_SIZE);
  }
  size_t offset = ACTION_OFFSET + BTN_COUNT * ACTION_SIZE;
  for (size_t enc = 0; enc < ENC_COUNT; ++enc) {
    for (size_t dir = 0; dir < 2; ++dir) {
      encodeAction(preset.preset.enc[enc][dir], out + offset);
      offset += ACTION_SIZE;
    }
  }
  writeLe16(out + CRC_OFFSET, crc16(out, CRC_OFFSET));
}

bool makeFactoryPreset(const Preset& source, uint8_t id, InstalledPreset& out) {
  if (id == 0 || !source.name) return false;
  size_t nameLength = strnlen(source.name, PRESET_NAME_MAX);
  if (nameLength == 0 || nameLength >= PRESET_NAME_MAX ||
      !validUtf8(reinterpret_cast<const uint8_t*>(source.name), nameLength)) {
    return false;
  }

  InstalledPreset preset = {};
  preset.id = id;
  memcpy(preset.name, source.name, nameLength + 1);
  preset.preset = source;
  preset.preset.name = preset.name;
  out = preset;
  out.preset.name = out.name;
  return true;
}

}  // namespace navio
