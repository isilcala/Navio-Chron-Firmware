#include "PresetManager.h"

#include <Preferences.h>

#include "ByteOrder.h"
#include "Config.h"
#include "proto/Crc.h"

namespace navio {

namespace {

constexpr size_t MANIFEST_SIZE = 18;
constexpr size_t MANIFEST_CRC_OFFSET = 16;

void recordKey(uint8_t id, char out[5]) {
  snprintf(out, 5, "p_%02X", id);
}

const char* manifestKey(uint8_t slot) {
  return slot == 0 ? "manifest_0" : "manifest_1";
}

bool decodeManifest(const uint8_t* data, PresetManager::Manifest& out, uint8_t slot) {
  if (data[0] != 'N' || data[1] != 'M' || data[2] != 1 || data[3] == 0 ||
      data[3] > PRESET_MAX_INSTALLED || data[5] != 0 ||
      crc16(data, MANIFEST_CRC_OFFSET) != readLe16(data + MANIFEST_CRC_OFFSET)) {
    return false;
  }
  PresetManager::Manifest manifest = {};
  manifest.count = data[3];
  manifest.activeId = data[4];
  manifest.generation = readLe32(data + 6);
  manifest.slot = slot;
  bool activeFound = false;
  for (uint8_t i = 0; i < PRESET_MAX_INSTALLED; ++i) {
    uint8_t id = data[10 + i];
    if (i >= manifest.count) {
      if (id != 0) return false;
      continue;
    }
    if (id == 0) return false;
    if (id == manifest.activeId) activeFound = true;
    for (uint8_t j = 0; j < i; ++j) {
      if (manifest.ids[j] == id) return false;
    }
    manifest.ids[i] = id;
  }
  if (!activeFound) return false;
  out = manifest;
  return true;
}

void encodeManifest(const PresetManager::Manifest& manifest, uint8_t* out) {
  memset(out, 0, MANIFEST_SIZE);
  out[0] = 'N';
  out[1] = 'M';
  out[2] = 1;
  out[3] = manifest.count;
  out[4] = manifest.activeId;
  writeLe32(out + 6, manifest.generation);
  memcpy(out + 10, manifest.ids, PRESET_MAX_INSTALLED);
  writeLe16(out + MANIFEST_CRC_OFFSET, crc16(out, MANIFEST_CRC_OFFSET));
}

}  // namespace

int PresetManager::indexOf_(uint8_t id) const {
  for (uint8_t i = 0; i < count_; ++i) {
    if (installed_[i].id == id) return i;
  }
  return -1;
}

const Preset& PresetManager::active() const {
  int index = indexOf_(activeId_);
  return index >= 0 ? installed_[index].preset : kPresets[0];
}

uint8_t PresetManager::index() const {
  int index = indexOf_(activeId_);
  return index >= 0 ? static_cast<uint8_t>(index) : 0;
}

bool PresetManager::loadFactory_(uint8_t activeId) {
  count_ = static_cast<uint8_t>(kPresetCount);
  for (uint8_t i = 0; i < count_; ++i) {
    if (!makeFactoryPreset(kPresets[i], i + 1, installed_[i])) {
      count_ = 0;
      activeId_ = 0;
      return false;
    }
  }
  activeId_ = indexOf_(activeId) >= 0 ? activeId : 1;
  generation_ = 0;
  manifestSlot_ = 0;
  return true;
}

bool PresetManager::readManifest_(Preferences& prefs, uint8_t slot, Manifest& out) const {
  const char* key = manifestKey(slot);
  uint8_t data[MANIFEST_SIZE];
  if (prefs.getBytesLength(key) != sizeof(data) ||
      prefs.getBytes(key, data, sizeof(data)) != sizeof(data)) {
    return false;
  }
  return decodeManifest(data, out, slot);
}

bool PresetManager::loadInstalled_(Preferences& prefs, const Manifest& manifest) {
  for (uint8_t i = 0; i < manifest.count; ++i) {
    uint8_t id = manifest.ids[i];
    char key[5];
    recordKey(id, key);
    size_t len = prefs.getBytesLength(key);
    if (len == 0 && id <= kPresetCount) {
      if (!makeFactoryPreset(kPresets[id - 1], id, installed_[i])) return false;
      continue;
    }
    if (len != PRESET_RECORD_SIZE) return false;
    uint8_t data[PRESET_RECORD_SIZE];
    if (prefs.getBytes(key, data, len) != len ||
        decodePresetRecord(data, len, installed_[i]) != PresetRecordResult::Ok) {
      return false;
    }
  }
  count_ = manifest.count;
  activeId_ = manifest.activeId;
  return true;
}

void PresetManager::begin() {
  uint8_t legacy = 0;
  bool loaded = false;
  int selected = -1;
  Manifest chosen;
  Manifest manifests[2];
  Preferences prefs;
  if (prefs.begin(PREFS_NAMESPACE, true)) {
    legacy = prefs.getUChar(PREFS_KEY_PRESET, 0);
    bool valid[2];
    for (uint8_t slot = 0; slot < 2; ++slot) {
      valid[slot] = readManifest_(prefs, slot, manifests[slot]);
    }
    if (valid[0] && valid[1]) {
      selected = static_cast<int32_t>(manifests[1].generation - manifests[0].generation) > 0 ? 1 : 0;
    } else if (valid[0]) {
      selected = 0;
    } else if (valid[1]) {
      selected = 1;
    }
    if (selected >= 0) {
      if (loadInstalled_(prefs, manifests[selected])) {
        chosen = manifests[selected];
        loaded = true;
      } else {
        int fallback = 1 - selected;
        if (valid[fallback] && loadInstalled_(prefs, manifests[fallback])) {
          chosen = manifests[fallback];
          loaded = true;
        }
      }
    }
    prefs.end();
  } else {
    Serial.println("[Navio] preset NVS read unavailable, using factory presets");
  }

  if (loaded) {
    generation_ = manifests[selected].generation;
    manifestSlot_ = chosen.slot;
  } else {
    uint8_t activeId = legacy < kPresetCount ? legacy + 1 : 1;
    if (!loadFactory_(activeId)) Serial.println("[Navio] factory preset load failed");
    if (selected >= 0) {
      generation_ = manifests[selected].generation;
      manifestSlot_ = manifests[selected].slot;
    }
  }
}

PresetChangeResult PresetManager::commit_(const InstalledPreset* next, uint8_t count,
                                          uint8_t activeId, const InstalledPreset* newRecord,
                                          bool collectGarbage) {
  if (count == 0 || count > PRESET_MAX_INSTALLED || activeId == 0) {
    return PresetChangeResult::Invalid;
  }
  bool activeFound = false;
  for (uint8_t i = 0; i < count; ++i) {
    if (next[i].id == activeId) activeFound = true;
  }
  if (!activeFound) return PresetChangeResult::Invalid;
  uint8_t nextSlot = generation_ == 0 ? 0 : 1 - manifestSlot_;
  uint32_t nextGeneration = generation_ + 1;

  Preferences prefs;
  if (!prefs.begin(PREFS_NAMESPACE, false)) return PresetChangeResult::NvsFailure;
  PresetChangeResult result = PresetChangeResult::Ok;
  if (newRecord) {
    uint8_t data[PRESET_RECORD_SIZE];
    encodePresetRecord(*newRecord, data);
    char key[5];
    recordKey(newRecord->id, key);
    if (prefs.putBytes(key, data, sizeof(data)) != sizeof(data)) {
      result = PresetChangeResult::NvsFailure;
    }
  }

  if (result == PresetChangeResult::Ok) {
    Manifest manifest = {};
    manifest.count = count;
    manifest.activeId = activeId;
    manifest.generation = nextGeneration;
    for (uint8_t i = 0; i < count; ++i) manifest.ids[i] = next[i].id;
    uint8_t data[MANIFEST_SIZE];
    encodeManifest(manifest, data);
    if (prefs.putBytes(manifestKey(nextSlot), data, sizeof(data)) != sizeof(data)) {
      result = PresetChangeResult::NvsFailure;
    }
  }
  if (result == PresetChangeResult::Ok && collectGarbage) {
    for (uint16_t id = 1; id <= UINT8_MAX; ++id) {
      bool referenced = false;
      for (uint8_t i = 0; i < count && !referenced; ++i) referenced = next[i].id == id;
      for (uint8_t i = 0; i < count_ && !referenced; ++i) referenced = installed_[i].id == id;
      if (referenced) continue;
      char key[5];
      recordKey(static_cast<uint8_t>(id), key);
      if (prefs.getBytesLength(key) > 0 && !prefs.remove(key)) {
        Serial.printf("[Navio] preset orphan cleanup failed: %s\n", key);
      }
    }
  }
  prefs.end();
  if (result != PresetChangeResult::Ok) return result;

  for (uint8_t i = 0; i < count; ++i) {
    installed_[i] = next[i];
    installed_[i].preset.name = installed_[i].name;
  }
  count_ = count;
  activeId_ = activeId;
  generation_ = nextGeneration;
  manifestSlot_ = nextSlot;
  return PresetChangeResult::Ok;
}

void PresetManager::cycle() {
  if (count_ == 0) return;
  uint8_t nextActive = installed_[(index() + 1) % count_].id;
  PresetChangeResult result = commit_(installed_, count_, nextActive);
  if (result != PresetChangeResult::Ok) {
    Serial.println("[Navio] active preset NVS write failed");
  }
}

PresetChangeResult PresetManager::write(const uint8_t* record, size_t len) {
  InstalledPreset incoming = {};
  PresetRecordResult decoded = decodePresetRecord(record, len, incoming);
  if (decoded == PresetRecordResult::UnsupportedVersion) {
    return PresetChangeResult::UnsupportedVersion;
  }
  if (decoded != PresetRecordResult::Ok) return PresetChangeResult::Invalid;

  int existing = indexOf_(incoming.id);
  if (existing < 0 && count_ >= PRESET_MAX_INSTALLED) return PresetChangeResult::Full;
  InstalledPreset next[PRESET_MAX_INSTALLED];
  for (uint8_t i = 0; i < count_; ++i) next[i] = installed_[i];
  uint8_t nextCount = count_;
  if (existing >= 0) {
    next[existing] = incoming;
  } else {
    next[nextCount++] = incoming;
  }
  return commit_(next, nextCount, activeId_, &incoming);
}

PresetChangeResult PresetManager::read(uint8_t id, uint8_t* out) const {
  int index = indexOf_(id);
  if (index < 0) return PresetChangeResult::NotFound;
  encodePresetRecord(installed_[index], out);
  return PresetChangeResult::Ok;
}

PresetChangeResult PresetManager::remove(uint8_t id) {
  int index = indexOf_(id);
  if (index < 0) return PresetChangeResult::NotFound;
  if (count_ == 1) return PresetChangeResult::BadState;

  InstalledPreset next[PRESET_MAX_INSTALLED];
  uint8_t nextCount = 0;
  for (uint8_t i = 0; i < count_; ++i) {
    if (i != index) next[nextCount++] = installed_[i];
  }
  uint8_t nextActive = activeId_ == id ? next[0].id : activeId_;
  return commit_(next, nextCount, nextActive, nullptr, true);
}

PresetChangeResult PresetManager::move(uint8_t id, uint8_t beforeId) {
  int from = indexOf_(id);
  if (from < 0 || beforeId == id) return PresetChangeResult::Invalid;
  if (beforeId != 0 && indexOf_(beforeId) < 0) return PresetChangeResult::NotFound;

  InstalledPreset next[PRESET_MAX_INSTALLED];
  uint8_t nextCount = 0;
  for (uint8_t i = 0; i < count_; ++i) {
    if (i != from) next[nextCount++] = installed_[i];
  }
  uint8_t insertAt = nextCount;
  if (beforeId != 0) {
    insertAt = 0;
    while (insertAt < nextCount && next[insertAt].id != beforeId) ++insertAt;
  }
  for (int i = nextCount; i > insertAt; --i) next[i] = next[i - 1];
  next[insertAt] = installed_[from];
  return commit_(next, count_, activeId_);
}

}  // namespace navio
