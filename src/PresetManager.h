#pragma once
// 预设管理：当前索引 + NVS 记忆 + 侧键循环切换
#include "mapping/Keymap.h"

namespace navio {

class PresetManager {
 public:
  void begin();  // 从 NVS 恢复上次预设，越界则回落 0
  const Preset& active() const { return kPresets[index_]; }
  uint8_t index() const { return index_; }
  uint8_t count() const { return static_cast<uint8_t>(kPresetCount); }
  void cycle();  // 切到下一个并持久化

 private:
  uint8_t index_ = 0;
};

}  // namespace navio
