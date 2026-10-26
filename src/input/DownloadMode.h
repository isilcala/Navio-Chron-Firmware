#pragma once
// 通用下载模式入口：BOOT 键(GPIO0) 长按 3 秒 → 紫灯 1.5s → ROM 下载模式。
// 从 main.cpp 提取，供 debug_boot / led_beacon 等诊断固件共用——
// 诊断固件没有侧键手势体系，此入口保证任何固件都能自救重刷（不依赖 BOOT 插拔）。
#include <Arduino.h>
#include "soc/rtc_cntl_reg.h"

#include "Pins.h"

namespace navio {

constexpr uint8_t PIN_BOOT_KEY = 0;
constexpr uint32_t BOOT_KEY_REFLASH_MS = 3000;

inline void enterDownloadMode() {
  // 到位确认：紫灯快闪 2 下（明确"已触发"）→ 常亮 0.8s → 重启进 ROM 下载模式
  for (int i = 0; i < 2; ++i) {
    neopixelWrite(PIN_BOARD_RGB, 120, 0, 120);
    delay(120);
    neopixelWrite(PIN_BOARD_RGB, 0, 0, 0);
    delay(120);
  }
  neopixelWrite(PIN_BOARD_RGB, 80, 0, 80);
  delay(800);
  SET_PERI_REG_MASK(RTC_CNTL_OPTION1_REG, RTC_CNTL_FORCE_DOWNLOAD_BOOT);
  esp_restart();
}

inline void checkBootKeyForDownload() {
  static uint32_t heldSince = 0;
  static bool armed = false;
  if (digitalRead(PIN_BOOT_KEY) == LOW) {
    if (!armed) {
      armed = true;
      heldSince = millis();
    } else if (millis() - heldSince >= BOOT_KEY_REFLASH_MS) {
      enterDownloadMode();
    }
  } else {
    armed = false;
  }
}

}  // namespace navio
