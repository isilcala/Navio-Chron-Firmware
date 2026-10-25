#pragma once
// Navio Chron 硬件引脚定义（与 docs/hardware/HARDWARE_NOTES.md 交叉验证一致）
#include <Arduino.h>

namespace navio {

// 键盘矩阵（行输出、平时高，扫描时拉低；列输入上拉；二极管方向 COL→开关→ROW）
constexpr uint8_t PIN_ROW[4] = {13, 12, 11, 10};  // ROW1..ROW4
constexpr uint8_t PIN_COL[5] = {6, 5, 4, 2, 1};   // COL1..COL5

// 编码器 A/B（均有外部 10k 上拉）
constexpr uint8_t PIN_ENC_CENTER_A = 9;    // SW23 中央旋钮
constexpr uint8_t PIN_ENC_CENTER_B = 8;
constexpr uint8_t PIN_ENC_LARGE_A  = 39;   // SW41 大旋钮（子板）
constexpr uint8_t PIN_ENC_LARGE_B  = 40;
constexpr uint8_t PIN_ENC_WHEEL_A  = 15;   // ENC3 滚轮（子板，无自带按压）
constexpr uint8_t PIN_ENC_WHEEL_B  = 14;

// WS2812 链：0-2 状态灯（U17-U19），3-14 按键灯（K1..K12），链尾 UA44
constexpr uint8_t PIN_LED_DATA = 7;
constexpr int LED_COUNT = 15;
constexpr int LED_STATUS_FIRST = 0;  // LED0=预设色, LED1=连接模式(预留), LED2=电量
constexpr int LED_KEY_FIRST = 3;

// 电池电压检测：÷2 分压接 GPIO3（ADC1_CH2，可用 analogReadMilliVolts）
constexpr uint8_t PIN_BATTERY_SENSE = 3;

// 保留：U9 空贴焊盘的 SDA/SCL（IO41/IO16），勿挪作他用
constexpr uint8_t PIN_RESERVED_SDA = 41;
constexpr uint8_t PIN_RESERVED_SCL = 16;

// 板载模块 RGB 在 GPIO48（未焊接阶段用作启动信标，正式固件不使用）
constexpr uint8_t PIN_BOARD_RGB = 48;

}  // namespace navio
