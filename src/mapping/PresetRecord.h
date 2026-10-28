#pragma once

#include "mapping/Keymap.h"

namespace navio {

constexpr size_t PRESET_RECORD_SIZE = 150;
constexpr size_t PRESET_NAME_MAX = 24;

struct InstalledPreset {
  uint8_t id = 0;
  char name[PRESET_NAME_MAX] = {};
  Preset preset;
};

enum class PresetRecordResult : uint8_t { Ok, Invalid, UnsupportedVersion };

PresetRecordResult decodePresetRecord(const uint8_t* data, size_t len, InstalledPreset& out);
void encodePresetRecord(const InstalledPreset& preset, uint8_t* out);
bool makeFactoryPreset(const Preset& source, uint8_t id, InstalledPreset& out);

}  // namespace navio
