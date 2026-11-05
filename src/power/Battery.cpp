#include "power/Battery.h"

#include "Config.h"
#include "Pins.h"

namespace navio {

void Battery::begin() {
  pinMode(PIN_BATTERY_SENSE, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_BATTERY_SENSE, ADC_11db);
  lastMs_ = millis() - BATTERY_CHECK_INTERVAL_MS;  // 立即触发首测
  tick();
}

// 电压→电量：查 BATTERY_CURVE 分段线性插值（表降序，低于末点=0%）
static uint8_t curveToPercent(uint16_t mv) {
  constexpr int N = sizeof(BATTERY_CURVE) / sizeof(BATTERY_CURVE[0]);
  if (mv >= BATTERY_CURVE[0][0]) return BATTERY_CURVE[0][1];
  for (int i = 1; i < N; ++i) {
    if (mv >= BATTERY_CURVE[i][0]) {
      uint32_t span = BATTERY_CURVE[i - 1][0] - BATTERY_CURVE[i][0];
      uint32_t off = mv - BATTERY_CURVE[i][0];
      return BATTERY_CURVE[i][1] +
             (BATTERY_CURVE[i - 1][1] - BATTERY_CURVE[i][1]) * off / span;
    }
  }
  return 0;
}

void Battery::tick() {
  uint32_t now = millis();
  if (now - lastMs_ < BATTERY_CHECK_INTERVAL_MS) return;
  lastMs_ = now;

  // 8 次采样去极值取平均，抑制 BLE 突发与 LED 纹波；analogReadMilliVolts 自带出厂校准
  uint32_t sum = 0, mn = 4000, mx = 0;
  for (int i = 0; i < 8; ++i) {
    uint32_t v = analogReadMilliVolts(PIN_BATTERY_SENSE);
    sum += v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  float mv = (sum - mn - mx) / 6.0f * BATTERY_DIVIDER_RATIO;

  // EMA 平滑 + 连续一致才提交（同按键消抖习惯）：尾段 1% 仅 ≈25mV，
  // 边界 5/6/5 抖动会让 Windows 低电提示反复弹出（D25）
  if (!seeded_) {
    seeded_ = true;
    mvEma_ = mv;
    lastRawPct_ = pct_ = curveToPercent(static_cast<uint16_t>(mv + 0.5f));
    confirm_ = BATTERY_CONFIRM_SAMPLES;
    return;
  }
  mvEma_ += (mv - mvEma_) * BATTERY_EMA_ALPHA;
  uint8_t raw = curveToPercent(static_cast<uint16_t>(mvEma_ + 0.5f));
  if (raw != lastRawPct_) {
    lastRawPct_ = raw;  // 新值挂起，等下一次采样确认
    confirm_ = 1;
    return;
  }
  if (++confirm_ >= BATTERY_CONFIRM_SAMPLES && pct_ != raw) pct_ = raw;
}

}  // namespace navio
