#pragma once
// WS2812 链：LED0 预设色 / LED1 连接模式 / LED2 电量 / LED3-14 按键底色
#include "Pins.h"

#include <Adafruit_NeoPixel.h>

namespace navio {

class LedController {
 public:
  void begin();
  void showPreset(const uint8_t accent[3], uint8_t rgbMode);
  void setKeyPressed(uint8_t key, bool pressed);
  void releaseKeys();
  void setModeColor(uint8_t r, uint8_t g, uint8_t b);  // LED1
  void flush();                                      // 阻塞过渡动画立即刷新
  void setBatteryLow(bool low);                        // LED2 红色慢闪
  void tick();                                         // 周期调用（灯效、闪烁与按需刷新）

 private:
  static constexpr uint8_t KEY_COUNT = LED_COUNT - LED_KEY_FIRST;
  static_assert(KEY_COUNT == 12);
  enum Mode : uint8_t { Reactive = 0, Breath = 1, Follow = 2, ColorCycle = 3, RainbowFlow = 4 };

  void setKeyColor_(uint8_t key, uint8_t level);
  void setKeyRgb_(uint8_t key, const uint8_t rgb[3]);
  void updateEffects_(uint32_t now);

  Adafruit_NeoPixel chain_{LED_COUNT, PIN_LED_DATA, NEO_GRB + NEO_KHZ800};
  uint8_t accent_[3] = {};
  uint8_t rgbMode_ = Reactive;
  bool keyHeld_[KEY_COUNT] = {};
  uint32_t confirmAt_[KEY_COUNT] = {};
  uint32_t fadeStartedAt_[KEY_COUNT] = {};
  uint32_t effectStartedAt_ = 0;
  bool lowBattery_ = false;
  bool blinkOn_ = false;
  bool dirty_ = false;
  uint32_t lastBlinkMs_ = 0;
  uint32_t lastShowMs_ = 0;
};

}  // namespace navio
