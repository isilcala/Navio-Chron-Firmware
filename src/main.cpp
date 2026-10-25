// Navio Chron firmware — 主程序
// 分层：输入扫描(input/) → 预设映射(mapping/) → 动作(action/) → HID 传输(hid/)
// 第一期：USB 传输；BLE 传输实现 ITransport 后在此切换/自动选择
#include <Arduino.h>

#include "Config.h"
#include "Pins.h"
#include "PresetManager.h"
#include "hid/ITransport.h"
#include "hid/UsbTransport.h"
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
static UsbTransport usbTransport;  // TODO(ble): BleTransport + 按连接状态自动选择
static ITransport* transport = &usbTransport;

static void dispatchButton(Btn id, bool pressed);
static void dispatchEncoder(Enc id, int8_t dir);

void setup() {
  // CDC 调试串口（platformio.ini 已开 USB CDC On Boot）
  Serial.begin(115200);

  battery.begin();
  leds.begin();
  matrix.begin();
  encoders.begin();
  presets.begin();

  usbTransport.begin();  // HID 就绪后才开始产生输入事件
  leds.showPreset(presets.active().accent, presets.active().name);
  leds.setModeColor(0, 60, 0);  // LED1 绿 = USB 模式
  // 板载 RGB 闪三下青色 = 启动完成信标（未焊接阶段的肉眼确认手段）
  for (int i = 0; i < 3; ++i) {
    neopixelWrite(PIN_BOARD_RGB, 0, 60, 60);
    delay(120);
    neopixelWrite(PIN_BOARD_RGB, 0, 0, 0);
    delay(120);
  }
  Serial.printf("[Navio] v" NAVIO_CHRON_FW_VERSION " ready, preset: %s\n",
                presets.active().name);
}

void loop() {
  // 1ms 输入轮询（矩阵整轮 + 编码器全量 <100µs）
  static uint32_t lastPollUs = 0;
  uint32_t nowUs = micros();
  if (nowUs - lastPollUs >= INPUT_POLL_INTERVAL_US) {
    lastPollUs = nowUs;

    matrix.poll();
    BtnEvent be;
    while (matrix.next(be)) dispatchButton(be.id, be.pressed);

    encoders.poll();
    EncoderEvent ee;
    while (encoders.next(ee)) dispatchEncoder(ee.id, ee.dir);
  }

  // 低频任务
  battery.tick();
  leds.setBatteryLow(battery.low());
  leds.tick();
}

static void switchPreset() {
  // 切预设前清空按键状态，避免旧和弦残留
  transport->releaseAll();
  presets.cycle();
  leds.showPreset(presets.active().accent, presets.active().name);
  Serial.printf("[Navio] preset -> %s\n", presets.active().name);
}

static void dispatchButton(Btn id, bool pressed) {
  if (id == Btn::SideKey) {  // 微动侧键固定作为预设切换
    if (pressed) switchPreset();
    return;
  }
  const Action& a = presets.active().btn[static_cast<size_t>(id)];
  if (!a) return;
  switch (a.kind) {
    case Action::KeyChord:
      if (pressed)
        transport->pressChord(a.mods, a.code);
      else
        transport->releaseChord(a.mods, a.code);
      break;
    case Action::Consumer:
      if (pressed)
        transport->consumerPress(a.code);
      else
        transport->consumerRelease();
      break;
    default:
      break;
  }
}

static void dispatchEncoder(Enc id, int8_t dir) {
  const Action& a = presets.active().enc[static_cast<size_t>(id)][dir > 0 ? 0 : 1];
  if (!a) return;
  switch (a.kind) {
    case Action::KeyChord:  // 点触：按下→短暂保持→抬起，保证主机识别组合键
      transport->pressChord(a.mods, a.code);
      delay(3);
      transport->releaseChord(a.mods, a.code);
      break;
    case Action::Consumer:
      transport->consumerPress(a.code);
      delay(3);
      transport->consumerRelease();
      break;
    case Action::Wheel:
      if (a.mods) {  // 带修饰键的滚轮（如 Ctrl+滚轮=缩放）
        transport->pressChord(a.mods, 0);
        transport->mouseWheel(a.wheelDy);
        delay(3);
        transport->releaseChord(a.mods, 0);
      } else {
        transport->mouseWheel(a.wheelDy);
      }
      break;
    default:
      break;
  }
}
