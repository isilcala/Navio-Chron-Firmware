#pragma once
// 可调参数集中处
#include <Arduino.h>

namespace navio {

// —— 输入扫描 ——
constexpr uint32_t INPUT_POLL_INTERVAL_US = 1000;  // 矩阵+编码器轮询周期
constexpr uint8_t  KEY_DEBOUNCE_TICKS = 3;         // 连续 N 次采样一致才认定状态变化
constexpr uint16_t ROW_SETTLE_US = 5;              // 行驱动后的电平稳定时间
constexpr uint32_t ENCODER_PULSE_US = 3000;        // 编码器点触动作的按下保持时间

// 编码器分频：原始四倍频计数 / 除数 = 触发次数。
// 上游固件全脉冲编码器用 2（每个棘齿触发 2 次），沿用其手感，硬件实测后可调。
constexpr int ENC_DETENT_DIVISOR[3] = {2, 2, 2};

// —— 电源 ——
// 分压比 2026-11-03 实测标定：电池 3.76V → GPIO3 1.713V（=2.195，非假设的 ÷2）。
// 充电中（含充电头：USB 不枚举）节点被充电电路抬高，读数偏高甚至 100%——接受，简单优先（D25）。
constexpr float BATTERY_DIVIDER_RATIO = 2.195f;
constexpr uint32_t BATTERY_CHECK_INTERVAL_MS = 5 * 1000;  // 5s：拔线后 ≤5s 恢复真值；采样功耗可忽略
// 消抖（D25）：EMA 平滑电压 + 连续 N 次采样一致才更新电量（同 KEY_DEBOUNCE_TICKS 习惯）。
// 尾段 1% 仅 ≈25mV，边界 5/6/5 抖动会让 Windows 低电提示反复弹出
constexpr float BATTERY_EMA_ALPHA = 0.35f;
constexpr uint8_t BATTERY_CONFIRM_SAMPLES = 2;
constexpr uint8_t BATTERY_LOW_PERCENT = 5;  // ≈3.43V；与 Windows 5% 低电提示一致（D25 四修）
// 放电曲线 {毫伏, 电量%} 降序，分段线性插值替代线性折算（锂电平台期 S 形）。
// 0% 锚 3.00V：实测力竭 2.865V，3.0-3.1V 为安全下限；满电 4.2V 对应 TP4054 CV。
constexpr uint16_t BATTERY_CURVE[][2] = {
    {4200, 100}, {4100, 92}, {4000, 83}, {3900, 72}, {3800, 55}, {3750, 45},
    {3700, 35},  {3650, 25}, {3600, 17}, {3500, 8},  {3400, 4},  {3300, 2},
    {3200, 1},   {3000, 0},
};

// —— LED ——
constexpr uint8_t LED_BRIGHTNESS = 48;      // 0-255，电池模式考虑功耗
constexpr uint32_t LED_TICK_INTERVAL_MS = 20;
constexpr uint32_t LED_REACTIVE_FADE_MS = 500;
constexpr uint32_t LED_BREATH_PERIOD_MS = 8000;
constexpr uint32_t LED_BREATH_DARK_HOLD_MS = 500;

// —— 预设 ——
constexpr const char* PREFS_NAMESPACE = "navio";
constexpr const char* PREFS_KEY_PRESET = "preset";

// —— 侧键长按分级（单击=切预设，无冲突的分级长按）——
constexpr uint32_t SIDE_HOLD_PAIRING_MS = 5000;   // 5s：蓝牙配对模式（Phase 1b）
constexpr uint32_t SIDE_HOLD_REFLASH_MS = 10000;  // 10s：固件烧写模式

}  // namespace navio
