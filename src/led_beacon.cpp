// 启动信标固件：用主控板载 RGB (GPIO48) 指示启动进度，不依赖串口/外部器件。
// 颜色语义：红=进入setup 绿=Serial就绪 蓝=电池 黄=LED链 紫=矩阵+编码器 青=全部完成(呼吸)
#include <Arduino.h>

#include "Pins.h"
#include "PresetManager.h"
#include "input/DownloadMode.h"
#include "input/Encoders.h"
#include "input/MatrixScanner.h"
#include "led/LedController.h"
#include "power/Battery.h"

using namespace navio;

static MatrixScanner matrix;
static Encoders encoders;
static LedController leds;
static Battery battery;
static PresetManager presets;

static void beacon(uint8_t r, uint8_t g, uint8_t b) {
  neopixelWrite(PIN_BOARD_RGB, r, g, b);
  delay(400);  // 拉长便于肉眼分辨
}

void setup() {
  beacon(80, 0, 0);  // 红：setup 已进入

  Serial.begin(115200);
  delay(200);
  beacon(0, 80, 0);  // 绿：Serial 就绪

  battery.begin();
  beacon(0, 0, 80);  // 蓝：电池检测 OK

  leds.begin();
  leds.showPreset(kPresets[0].accent, kPresets[0].name);
  beacon(80, 80, 0);  // 黄：WS2812 链驱动 OK

  matrix.begin();
  encoders.begin();
  beacon(80, 0, 80);  // 紫：矩阵+编码器引脚配置 OK

  presets.begin();
  beacon(0, 80, 80);  // 青：全部初始化完成
}

void loop() {
  // 青色呼吸 = 固件存活心跳
  for (int i = 0; i <= 40; i += 4) {
    neopixelWrite(PIN_BOARD_RGB, 0, i, i);
    delay(30);
    checkBootKeyForDownload();  // 自救出口：BOOT 长按 3s 进下载模式
  }
  for (int i = 40; i >= 0; i -= 4) {
    neopixelWrite(PIN_BOARD_RGB, 0, i, i);
    delay(30);
    checkBootKeyForDownload();
  }
}
