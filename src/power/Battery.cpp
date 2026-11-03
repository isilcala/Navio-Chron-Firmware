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
  float pinMv = (sum - mn - mx) / 6.0f;
  pct_ = curveToPercent(static_cast<uint16_t>(pinMv * BATTERY_DIVIDER_RATIO));
}

}  // namespace navio
