#pragma once

#include <Arduino.h>

namespace navio {

class HidInputState {
 public:
  void pressChord(uint8_t modMask, uint16_t usage) {
    for (uint8_t bit = 0; bit < 8; ++bit) {
      if ((modMask & (1U << bit)) && modCounts_[bit] < UINT8_MAX) ++modCounts_[bit];
    }
    if (!usage) return;

    int slot = keySlot_(usage, true);
    if (slot < 0) return;
    keys_[slot] = static_cast<uint8_t>(usage);
    if (keyCounts_[slot] < UINT8_MAX) ++keyCounts_[slot];
  }

  void releaseChord(uint8_t modMask, uint16_t usage) {
    for (uint8_t bit = 0; bit < 8; ++bit) {
      if ((modMask & (1U << bit)) && modCounts_[bit]) --modCounts_[bit];
    }
    if (!usage) return;

    int slot = keySlot_(usage, false);
    if (slot < 0 || !keyCounts_[slot]) return;
    if (--keyCounts_[slot] == 0) keys_[slot] = 0;
  }

  void pressConsumer(uint16_t usage) {
    for (uint16_t& held : consumerHolds_) {
      if (!held) {
        held = usage;
        return;
      }
    }
  }

  void releaseConsumer(uint16_t usage) {
    for (int i = MAX_CONSUMER_HOLDS - 1; i >= 0; --i) {
      if (consumerHolds_[i] != usage) continue;
      for (size_t j = i; j + 1 < MAX_CONSUMER_HOLDS; ++j) {
        consumerHolds_[j] = consumerHolds_[j + 1];
      }
      consumerHolds_[MAX_CONSUMER_HOLDS - 1] = 0;
      return;
    }
  }

  void releaseAll() {
    memset(modCounts_, 0, sizeof(modCounts_));
    memset(keys_, 0, sizeof(keys_));
    memset(keyCounts_, 0, sizeof(keyCounts_));
    memset(consumerHolds_, 0, sizeof(consumerHolds_));
  }

  uint8_t mods() const {
    uint8_t result = 0;
    for (uint8_t bit = 0; bit < 8; ++bit) {
      if (modCounts_[bit]) result |= 1U << bit;
    }
    return result;
  }

  const uint8_t* keys() const { return keys_; }

  uint16_t consumerUsage() const {
    for (int i = MAX_CONSUMER_HOLDS - 1; i >= 0; --i) {
      if (consumerHolds_[i]) return consumerHolds_[i];
    }
    return 0;
  }

 private:
  static constexpr size_t MAX_CONSUMER_HOLDS = 16;

  uint8_t modCounts_[8] = {};
  uint8_t keys_[6] = {};
  uint8_t keyCounts_[6] = {};
  uint16_t consumerHolds_[MAX_CONSUMER_HOLDS] = {};

  int keySlot_(uint16_t usage, bool allocate) const {
    for (int i = 0; i < 6; ++i) {
      if (keys_[i] == usage) return i;
    }
    if (allocate) {
      for (int i = 0; i < 6; ++i) {
        if (!keys_[i]) return i;
      }
    }
    return -1;
  }
};

}  // namespace navio
