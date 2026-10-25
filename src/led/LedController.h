#pragma once
// WS2812 链：LED0 预设色 / LED1 连接模式(预留) / LED2 电量 / LED3-14 按键底色
// 后端按 Arduino core 版本选择（见 DECISIONS.md D8/D10）：
//   core 3.x (IDF5)  -> Adafruit_NeoPixel（新 RMT 路径，社区生态）
//   core 2.x (IDF4)  -> 自研 Ws2812（Adafruit 在该组合死锁）
// 两者方法面同构（begin/setPixelColor/clear/show）
#include "Pins.h"

#if ESP_ARDUINO_VERSION_MAJOR >= 3
#include <Adafruit_NeoPixel.h>
#else
#include "led/Ws2812.h"
#endif

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
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  Adafruit_NeoPixel chain_{LED_COUNT, PIN_LED_DATA, NEO_GRB + NEO_KHZ800};
#else
  Ws2812 chain_{PIN_LED_DATA, LED_COUNT};
#endif
  bool lowBattery_ = false;
  bool blinkOn_ = false;
  uint32_t lastTickMs_ = 0;
};

}  // namespace navio
