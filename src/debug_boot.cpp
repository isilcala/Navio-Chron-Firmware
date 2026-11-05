// 诊断固件：分步初始化日志 + 输入事件打印（经硬件 USB-Serial/JTAG 控制台输出）
// 用于定位主固件启动早期无 USB 枚举的问题
#include <Arduino.h>
#include <esp_system.h>

#include "Pins.h"
#include "PresetManager.h"
#include "input/DownloadMode.h"
#include "input/Encoders.h"
#include "input/InputEvents.h"
#include "input/MatrixScanner.h"
#include "led/LedController.h"
#include "power/Battery.h"

using namespace navio;

static MatrixScanner matrix;
static Encoders encoders;
static LedController leds;
static Battery battery;
static PresetManager presets;

static void step(const char* name) {
  Serial.printf("[step] %s ... OK (heap=%u)\n", name, ESP.getFreeHeap());
  Serial.flush();
}

void setup() {
  Serial.begin(115200);
  delay(300);  // 等主机打开端口
  Serial.println("\n=== navio debug_boot ===");
  Serial.printf("chip: rev%d, %dMB flash, PSRAM=%d\n", ESP.getChipRevision(),
                ESP.getFlashChipSize() / 1024 / 1024, psramFound());

  battery.begin();
  step("battery");
  leds.begin();
  step("leds");
  matrix.begin();
  step("matrix");
  encoders.begin();
  step("encoders");
  presets.begin();
  step("presets(NVS)");
  leds.showPreset(presets.active().accent, presets.active().rgbMode);
  Serial.printf("[done] preset=%s battery=%d%%\n", presets.active().name,
                battery.percent());
  Serial.println(">>> 按任意键/转动编码器，事件将打印到此处 <<<");
}

void loop() {
  static uint32_t lastBeat = 0;
  uint32_t now = millis();
  if (now - lastBeat >= 5000) {
    lastBeat = now;
    Serial.printf("[beat] %lus heap=%u\n", (unsigned long)(now / 1000),
                  ESP.getFreeHeap());
  }

  // 编码器原始电平监测：任一引脚电平变化即打印（定位 A/B 断线/固件解码问题）
  static uint8_t lastLevels = 0xFF;
  uint8_t levels = (digitalRead(PIN_ENC_CENTER_A) << 5) | (digitalRead(PIN_ENC_CENTER_B) << 4) |
                   (digitalRead(PIN_ENC_LARGE_A) << 3) | (digitalRead(PIN_ENC_LARGE_B) << 2) |
                   (digitalRead(PIN_ENC_WHEEL_A) << 1) | digitalRead(PIN_ENC_WHEEL_B);
  if (levels != lastLevels) {
    Serial.printf("[raw ] %lu C=%d%d L=%d%d W=%d%d\n", (unsigned long)millis(),
                  (levels >> 5) & 1, (levels >> 4) & 1, (levels >> 3) & 1,
                  (levels >> 2) & 1, (levels >> 1) & 1, levels & 1);
    lastLevels = levels;
  }

  matrix.poll();
  BtnEvent be;
  while (matrix.next(be))
    Serial.printf("[btn ] %s %s\n", BTN_NAMES[(int)be.id], be.pressed ? "DOWN" : "UP");

  encoders.poll();
  EncoderEvent ee;
  while (encoders.next(ee))
    Serial.printf("[enc ] %s %+d\n", ENC_NAMES[(int)ee.id], ee.dir);

  // 诊断固件的自救出口：BOOT 长按 3 秒进下载模式（无侧键手势体系）
  checkBootKeyForDownload();
}
