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
  neopixelWrite(PIN_BOARD_RGB, 80, 0, 80);  // 紫：模块板载 RGB
  delay(1500);
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
