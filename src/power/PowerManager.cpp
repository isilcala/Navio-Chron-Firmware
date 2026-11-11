#include "power/PowerManager.h"

#include <driver/rtc_io.h>
#include <esp_sleep.h>

#include "Config.h"
#include "Pins.h"

namespace navio {

void PowerManager::begin() {
  lastActivityMs_ = millis();
}

void PowerManager::notifyActivity() {
  lastActivityMs_ = millis();
}

bool PowerManager::lightingIdle() const {
  return millis() - lastActivityMs_ >= POWER_LIGHTING_IDLE_MS;
}

bool PowerManager::deepSleepDue() const {
  return millis() - lastActivityMs_ >= POWER_DEEP_SLEEP_MS;
}

bool PowerManager::wokeFromDeepSleep() {
  return esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT1;
}

void PowerManager::restoreAfterWake() {
  for (uint8_t pin : PIN_ROW) {
    const gpio_num_t gpio = static_cast<gpio_num_t>(pin);
    rtc_gpio_hold_dis(gpio);
    rtc_gpio_deinit(gpio);
  }
  for (uint8_t pin : PIN_COL) {
    const gpio_num_t gpio = static_cast<gpio_num_t>(pin);
    rtc_gpio_hold_dis(gpio);
    rtc_gpio_deinit(gpio);
  }
}

bool PowerManager::prepareDeepSleep() {
  for (uint8_t pin : PIN_ROW) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  }
  for (uint8_t pin : PIN_COL) pinMode(pin, INPUT_PULLUP);
  delayMicroseconds(100);
  for (uint8_t pin : PIN_COL) {
    if (digitalRead(pin) == LOW) {
      Serial.printf("[Navio] deep sleep blocked: GPIO%u still low\n", pin);
      for (uint8_t row : PIN_ROW) digitalWrite(row, HIGH);
      return false;
    }
  }

  for (uint8_t pin : PIN_ROW) {
    const gpio_num_t gpio = static_cast<gpio_num_t>(pin);
    rtc_gpio_init(gpio);
    rtc_gpio_set_direction(gpio, RTC_GPIO_MODE_OUTPUT_ONLY);
    rtc_gpio_set_level(gpio, LOW);
    rtc_gpio_hold_en(gpio);
  }
  uint64_t mask = 0;
  for (uint8_t pin : PIN_COL) {
    const gpio_num_t gpio = static_cast<gpio_num_t>(pin);
    rtc_gpio_init(gpio);
    rtc_gpio_set_direction(gpio, RTC_GPIO_MODE_INPUT_ONLY);
    rtc_gpio_pullup_en(gpio);
    rtc_gpio_pulldown_dis(gpio);
    rtc_gpio_hold_en(gpio);
    mask |= 1ULL << pin;
  }
  esp_err_t result = esp_sleep_enable_ext1_wakeup(mask, ESP_EXT1_WAKEUP_ANY_LOW);
  if (result != ESP_OK) {
    Serial.printf("[Navio] deep sleep wakeup setup failed: %d\n", result);
    for (uint8_t pin : PIN_ROW) {
      const gpio_num_t gpio = static_cast<gpio_num_t>(pin);
      rtc_gpio_hold_dis(gpio);
      rtc_gpio_deinit(gpio);
      pinMode(pin, OUTPUT);
      digitalWrite(pin, HIGH);
    }
    for (uint8_t pin : PIN_COL) {
      const gpio_num_t gpio = static_cast<gpio_num_t>(pin);
      rtc_gpio_hold_dis(gpio);
      rtc_gpio_deinit(gpio);
      pinMode(pin, INPUT_PULLUP);
    }
    return false;
  }
  return true;
}

void PowerManager::enterDeepSleep() {
  esp_deep_sleep_start();
}

}  // namespace navio
