#pragma once
// 可调参数集中处
#include <Arduino.h>

namespace navio {

// —— 输入扫描 ——
constexpr uint32_t INPUT_POLL_INTERVAL_US = 1000;  // 矩阵+编码器轮询周期
constexpr uint8_t  KEY_DEBOUNCE_TICKS = 3;         // 连续 N 次采样一致才认定状态变化
constexpr uint16_t ROW_SETTLE_US = 5;              // 行驱动后的电平稳定时间

// 编码器分频：原始四倍频计数 / 除数 = 触发次数。
// 上游固件全脉冲编码器用 2（每个棘齿触发 2 次），沿用其手感，硬件实测后可调。
constexpr int ENC_DETENT_DIVISOR[3] = {2, 2, 2};

// —— 电源 ——
constexpr float BATTERY_MIN_VOLTAGE = 3.10;  // 电量 0% 参考
constexpr float BATTERY_FULL_VOLTAGE = 4.19;
constexpr uint32_t BATTERY_CHECK_INTERVAL_MS = 30 * 1000;
constexpr uint8_t BATTERY_LOW_PERCENT = 15;

// —— LED ——
constexpr uint8_t LED_BRIGHTNESS = 48;      // 0-255，电池模式考虑功耗
constexpr uint32_t LED_TICK_INTERVAL_MS = 20;

// —— 预设 ——
constexpr const char* PREFS_NAMESPACE = "navio";
constexpr const char* PREFS_KEY_PRESET = "preset";

// —— 侧键长按分级（单击=切预设，无冲突的分级长按）——
constexpr uint32_t SIDE_HOLD_PAIRING_MS = 5000;   // 5s：蓝牙配对模式（Phase 1b）
constexpr uint32_t SIDE_HOLD_REFLASH_MS = 10000;  // 10s：固件烧写模式

}  // namespace navio
