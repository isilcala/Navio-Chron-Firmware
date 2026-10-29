#pragma once
// 出厂/动态预设运行时安装与双 manifest 持久化
#include "mapping/PresetRecord.h"

class Preferences;

namespace navio {

constexpr size_t PRESET_MAX_INSTALLED = 6;

enum class PresetChangeResult : uint8_t {
  Ok,
  NotFound,
  Full,
  Invalid,
  UnsupportedVersion,
  NvsFailure,
  BadState,
};

class PresetManager {
 public:
  void begin();
  const Preset& active() const;
  uint8_t activeId() const { return activeId_; }
  uint8_t index() const;
  uint8_t count() const { return count_; }
  const InstalledPreset& entryAt(uint8_t index) const { return installed_[index]; }
  void cycle();

  PresetChangeResult write(const uint8_t* record, size_t len);
  PresetChangeResult read(uint8_t id, uint8_t* out) const;
  PresetChangeResult remove(uint8_t id);
  PresetChangeResult move(uint8_t id, uint8_t beforeId);

  struct Manifest {
    uint8_t count = 0;
    uint8_t activeId = 0;
    uint8_t ids[PRESET_MAX_INSTALLED] = {};
    uint32_t generation = 0;
    uint8_t slot = 0;
  };

  InstalledPreset installed_[PRESET_MAX_INSTALLED];
  uint8_t count_ = 0;
  uint8_t activeId_ = 0;
  uint32_t generation_ = 0;
  uint8_t manifestSlot_ = 0;

  int indexOf_(uint8_t id) const;
  bool loadFactory_(uint8_t activeId);
  bool readManifest_(Preferences& prefs, uint8_t slot, Manifest& out) const;
  bool loadInstalled_(Preferences& prefs, const Manifest& manifest);
  PresetChangeResult commit_(const InstalledPreset* next, uint8_t count, uint8_t activeId,
                             const InstalledPreset* newRecord = nullptr);
};

}  // namespace navio
