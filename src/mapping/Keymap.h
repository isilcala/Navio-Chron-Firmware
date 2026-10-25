#pragma once
// 预设数据结构：预设 = 一套完整的输入→动作映射（编译期固化，第二期改为 NVS 动态）
#include "action/Action.h"
#include "hid/HidUsage.h"
#include "input/InputEvents.h"

namespace navio {

struct Preset {
  const char* name;        // 串口/日志显示用
  uint8_t accent[3];       // RGB：状态灯 LED0 与按键底色
  // 按键为"按住"语义：按下 press、松开 release（修饰键可被持续按住）
  Action btn[BTN_COUNT];
  // 编码器为"点触"语义：[0]=顺时针 [1]=逆时针，每次触发即完整按下+抬起
  Action enc[ENC_COUNT][2];
};

// 预设清单（mapping/Presets.cpp 定义）
extern const Preset kPresets[];
extern const size_t kPresetCount;

}  // namespace navio
