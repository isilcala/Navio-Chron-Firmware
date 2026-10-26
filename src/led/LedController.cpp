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
}

void LedController::setModeColor(uint8_t r, uint8_t g, uint8_t b) {
  chain_.setPixelColor(1, scale(r), scale(g), scale(b));
  chain_.show();
}

void LedController::setBatteryLow(bool low) {
  if (low == lowBattery_) return;  // 状态无变化不重刷（rmtWriteBlocking 忙等，禁止高频调用）
  lowBattery_ = low;
  if (!low) {
    chain_.setPixelColor(2, 0, 0, 0);
    chain_.show();
  }
}

void LedController::tick() {
  uint32_t now = millis();
  if (now - lastTickMs_ < 1000) return;  // 低电闪烁周期 1s
  lastTickMs_ = now;
  if (!lowBattery_) return;
  blinkOn_ = !blinkOn_;
  chain_.setPixelColor(2, blinkOn_ ? scale(255) : 0, 0, 0);
  chain_.show();
}

}  // namespace navio
