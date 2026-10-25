#pragma once
// 预设里的"动作"：输入事件 → 动作 → 传输层。键码均为 HID Usage ID（见 HidUsage.h）
#include <Arduino.h>

#include "hid/HidUsage.h"

namespace navio {

struct Action {
  enum Kind : uint8_t { None = 0, KeyChord, Consumer, Wheel } kind = None;
  uint8_t mods = 0;      // KeyChord / Wheel 的修饰键掩码
  uint16_t code = 0;     // KeyChord: 键盘 usage；Consumer: 消费控制 usage
  int8_t wheelDy = 0;    // Wheel: 每次触发的滚轮格数

  explicit constexpr operator bool() const { return kind != None; }
};

constexpr Action actNone() { return Action{}; }
constexpr Action actKey(uint8_t mods, uint16_t usage) {
  return Action{Action::KeyChord, mods, usage, 0};
}
constexpr Action actConsumer(uint16_t usage) {
  return Action{Action::Consumer, MOD_NONE, usage, 0};
}
constexpr Action actWheel(int8_t dy, uint8_t mods = MOD_NONE) {
  return Action{Action::Wheel, mods, 0, dy};
}

}  // namespace navio
