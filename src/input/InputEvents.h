#pragma once
// 统一的逻辑输入事件：硬件层只产生事件，不关心 HID 和预设
#include <Arduino.h>

namespace navio {

// 12 颗带灯按键，编号与 LED 链一致：K1..K12 ↔ LED3..LED14（矩阵位见注释）
enum class Btn : uint8_t {
  K1,  // R1C2 UA12  LED3
  K2,  // R1C3 UA13  LED4
  K3,  // R1C4 UA14  LED5
  K4,  // R2C4 UA24  LED6
  K5,  // R2C5 UA25  LED7
  K6,  // R3C5 UB35  LED8
  K7,  // R3C4 UB34  LED9
  K8,  // R3C3 UB33  LED10
  K9,  // R3C2 UB32  LED11
  K10, // R4C2 UA42  LED12
  K11, // R4C3 UA43  LED13
  K12, // R4C4 UA44  LED14
  EncCenterPress,  // R2C3 SW23 中央旋钮按压
  EncLargePress,   // R4C1 SW41 大旋钮按压
  SideKey,         // R1C1 SW11 微动（滚轮按压兼侧键；固件固定用作预设切换）
  Tact,            // R2C1 SW21 独立轻触（用途待硬件确认，先按普通键）
  Count
};
constexpr size_t BTN_COUNT = static_cast<size_t>(Btn::Count);

enum class Enc : uint8_t { Center, Large, Wheel, Count };
constexpr size_t ENC_COUNT = static_cast<size_t>(Enc::Count);

struct BtnEvent {
  Btn id;
  bool pressed;
};

struct EncoderEvent {
  Enc id;
  int8_t dir;  // +1 / -1，每个触发事件一次
};

}  // namespace navio
