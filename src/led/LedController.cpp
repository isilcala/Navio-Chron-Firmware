#include "led/LedController.h"

#include "Config.h"
#include "Pins.h"

namespace navio {

// 统一缩放到全局亮度，避免预设里到处出现魔数
static uint8_t scale(uint8_t c) {
  return (uint16_t)c * LED_BRIGHTNESS / 255;
}

void LedController::begin() {
  chain_.begin();  // 内部含一次全灭 show()
}

void LedController::showPreset(const uint8_t accent[3], const char* name) {
  (void)name;
  chain_.setPixelColor(0, scale(accent[0]), scale(accent[1]), scale(accent[2]));
  // 按键底色 = accent × 全局亮度（scale 已含亮度控制；曾误加 /4 二次衰减到 4.7% 不可见）
  for (int i = LED_KEY_FIRST; i < LED_COUNT; ++i) {
    chain_.setPixelColor(i, scale(accent[0]), scale(accent[1]), scale(accent[2]));
  }
  chain_.show();
  dirty_ = false;
  lastShowMs_ = millis();
}

void LedController::setModeColor(uint8_t r, uint8_t g, uint8_t b) {
  uint32_t color = chain_.Color(scale(r), scale(g), scale(b));
  if (chain_.getPixelColor(1) == color) return;
  chain_.setPixelColor(1, color);
  dirty_ = true;
}

void LedController::setBatteryLow(bool low) {
  if (low == lowBattery_) return;
  lowBattery_ = low;
  if (!low) {
    chain_.setPixelColor(2, 0, 0, 0);
    dirty_ = true;
  }
}

void LedController::tick() {
  uint32_t now = millis();
  if (now - lastBlinkMs_ >= 1000) {
    lastBlinkMs_ = now;
    if (lowBattery_) {
      blinkOn_ = !blinkOn_;
      chain_.setPixelColor(2, blinkOn_ ? scale(255) : 0, 0, 0);
      dirty_ = true;
    }
  }
  if (!dirty_ || now - lastShowMs_ < LED_TICK_INTERVAL_MS) return;
  chain_.show();
  dirty_ = false;
  lastShowMs_ = now;
}

}  // namespace navio
