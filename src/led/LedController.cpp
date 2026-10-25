#include "led/LedController.h"

#include "Config.h"
#include "Pins.h"

namespace navio {

// 统一缩放到全局亮度，避免预设里到处出现魔数
static uint8_t scale(uint8_t c) {
  return (uint16_t)c * LED_BRIGHTNESS / 255;
}

void LedController::begin() {
  pixels_.begin();
  pixels_.clear();
  pixels_.show();
}

void LedController::showPreset(const uint8_t accent[3], const char* name) {
  (void)name;
  pixels_.setPixelColor(0, scale(accent[0]), scale(accent[1]), scale(accent[2]));
  // 按键底色：accent 的 1/4，通电即知道当前预设，又不刺眼耗电
  for (int i = LED_KEY_FIRST; i < LED_COUNT; ++i) {
    pixels_.setPixelColor(i, scale(accent[0]) / 4, scale(accent[1]) / 4, scale(accent[2]) / 4);
  }
  pixels_.show();
}

void LedController::setModeColor(uint8_t r, uint8_t g, uint8_t b) {
  pixels_.setPixelColor(1, scale(r), scale(g), scale(b));
  pixels_.show();
}

void LedController::setBatteryLow(bool low) {
  lowBattery_ = low;
  if (!low) {
    pixels_.setPixelColor(2, 0, 0, 0);
    pixels_.show();
  }
}

void LedController::tick() {
  uint32_t now = millis();
  if (now - lastTickMs_ < 1000) return;  // 低电闪烁周期 1s
  lastTickMs_ = now;
  if (!lowBattery_) return;
  blinkOn_ = !blinkOn_;
  pixels_.setPixelColor(2, blinkOn_ ? scale(255) : 0, 0, 0);
  pixels_.show();
}

}  // namespace navio
