#include "PresetManager.h"

#include <Preferences.h>

#include "Config.h"

namespace navio {

void PresetManager::begin() {
  Preferences prefs;
  prefs.begin(PREFS_NAMESPACE, true);
  uint8_t saved = prefs.getUChar(PREFS_KEY_PRESET, 0);
  prefs.end();
  index_ = (saved < kPresetCount) ? saved : 0;
}

void PresetManager::cycle() {
  index_ = (index_ + 1) % kPresetCount;
  Preferences prefs;
  prefs.begin(PREFS_NAMESPACE, false);
  prefs.putUChar(PREFS_KEY_PRESET, index_);
  prefs.end();
}

}  // namespace navio
