#pragma once
// WS2812 链：LED0 预设色 / LED1 连接模式 / LED2 电量 / LED3-14 按键底色
#include "Pins.h"

#include <Adafruit_NeoPixel.h>

namespace navio {

class LedController {
 public:
  void begin();
  // 应用预设：LED0 = accent，按键灯 = accent×0.25 底色
  void showPreset(const uint8_t accent[3], const char* name);
  void setModeColor(uint8_t r, uint8_t g, uint8_t b);  // LED1
  void setBatteryLow(bool low);                        // LED2 红色慢闪
  void tick();                                         // 周期调用（闪烁都在这里）

 private:
  Adafruit_NeoPixel chain_{LED_COUNT, PIN_LED_DATA, NEO_GRB + NEO_KHZ800};
  bool lowBattery_ = false;
  bool blinkOn_ = false;
  uint32_t lastTickMs_ = 0;
};

}  // namespace navio
