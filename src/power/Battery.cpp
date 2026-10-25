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

void Battery::tick() {
  uint32_t now = millis();
  if (now - lastMs_ < BATTERY_CHECK_INTERVAL_MS) return;
  lastMs_ = now;

  // 分压比 ÷2（两颗等值电阻），analogReadMilliVolts 自带出厂校准
  float volts = analogReadMilliVolts(PIN_BATTERY_SENSE) * 2.0f / 1000.0f;
  float ratio = (volts - BATTERY_MIN_VOLTAGE) / (BATTERY_FULL_VOLTAGE - BATTERY_MIN_VOLTAGE);
  if (ratio < 0) ratio = 0;
  if (ratio > 1) ratio = 1;
  pct_ = static_cast<uint8_t>(ratio * 100 + 0.5f);
}

}  // namespace navio
