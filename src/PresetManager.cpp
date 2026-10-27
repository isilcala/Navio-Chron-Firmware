#include "PresetManager.h"

#include <Preferences.h>

#include "Config.h"

namespace navio {

void PresetManager::begin() {
  Preferences prefs;
  if (!prefs.begin(PREFS_NAMESPACE, true)) {
    index_ = 0;
    Serial.println("[Navio] preset NVS read unavailable, using default");
    return;
  }
  uint8_t saved = prefs.getUChar(PREFS_KEY_PRESET, 0);
  prefs.end();
  index_ = (saved < kPresetCount) ? saved : 0;
}

void PresetManager::cycle() {
  index_ = (index_ + 1) % kPresetCount;
  Preferences prefs;
  if (!prefs.begin(PREFS_NAMESPACE, false)) {
    Serial.println("[Navio] preset NVS write initialization failed");
    return;
  }
  if (prefs.putUChar(PREFS_KEY_PRESET, index_) != 1) {
    Serial.println("[Navio] preset NVS write failed");
  }
  prefs.end();
}

}  // namespace navio
