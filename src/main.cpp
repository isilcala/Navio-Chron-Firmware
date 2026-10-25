// Navio Chron firmware — 主程序
// 分层：输入扫描(input/) → 预设映射(mapping/) → 动作(action/) → HID 传输(hid/)
// 第一期：USB 传输；BLE 传输实现 ITransport 后在此切换/自动选择
#include <Arduino.h>
#include "soc/rtc_cntl_reg.h"  // BOOT 长按强制进入 ROM 下载模式用

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
static void checkLongPressActions();
static void enterDownloadMode();  // 紫灯提示后重启进 ROM 下载模式

// 主控板上 BOOT 键 = GPIO0（矩阵/编码器均未占用）。
// 长按 3 秒 = 写 RTC 强制下载标志并重启（裸板调试入口，组装后难按仅兜底）。
constexpr uint8_t PIN_BOOT_KEY = 0;
constexpr uint32_t BOOT_KEY_REFLASH_MS = 3000;
// 组装后主入口 = 侧键（SW11, R1C1，全局保留键）分级长按：
// 单击=切预设（即时）；长按 5s=蓝牙配对（Phase 1b）；长按 10s=固件烧写；
// 插电/复位时按住侧键同样进烧写。按住期间 LED1 实时渐变反馈进度。
constexpr uint8_t SIDE_KEY_ROW = 0, SIDE_KEY_COL = 0;
static void dispatchEncoder(Enc id, int8_t dir);

void setup() {
  // 板载 RGB 启动信标（未焊接阶段唯一的可视化调试手段）
  // 绿=进入setup 蓝=即将启动USB 青×3=全部完成
  neopixelWrite(PIN_BOARD_RGB, 0, 50, 0);
  delay(300);

  // 启动早期检查：插电/复位时按住侧键 → 直接进下载模式（组装后 BOOT 键难按的替代入口）
  matrix.begin();
  if (matrix.rawKeyDown(SIDE_KEY_ROW, SIDE_KEY_COL)) {
    enterDownloadMode();
    return;  // 不会到达，保险
  }

  battery.begin();
  leds.begin();
  encoders.begin();
  presets.begin();
  pinMode(PIN_BOOT_KEY, INPUT_PULLUP);
  // matrix.begin() 已在启动早期完成（侧键下载模式检查），此处不重复

  neopixelWrite(PIN_BOARD_RGB, 0, 0, 50);  // 蓝：接下来是 USB 初始化
  delay(300);
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
  checkLongPressActions();

  delay(1);  // 让出 CPU（避免忙转饿死其他任务）
}

static void enterDownloadMode() {
  neopixelWrite(PIN_BOARD_RGB, 80, 0, 80);  // 紫：进入下载模式
  delay(1500);                              // 常亮足够久，肉眼明确可见
  SET_PERI_REG_MASK(RTC_CNTL_OPTION1_REG, RTC_CNTL_FORCE_DOWNLOAD_BOOT);
  esp_restart();
}

// 侧键长按进度 → LED1 颜色：0-5s 蓝色渐亮（配对档），5-10s 蓝→紫渐变（烧写档）
static void showSideHoldProgress(uint32_t heldMs) {
  if (heldMs < SIDE_HOLD_PAIRING_MS) {
    uint8_t b = 20 + (uint8_t)(100 * heldMs / SIDE_HOLD_PAIRING_MS);
    leds.setModeColor(0, 0, b);
  } else {
    uint32_t t = heldMs - SIDE_HOLD_PAIRING_MS;
    uint32_t span = SIDE_HOLD_REFLASH_MS - SIDE_HOLD_PAIRING_MS;
    uint8_t r = (uint8_t)(100 * t / span);
    leds.setModeColor(r, 0, 100);
  }
}

static void enterPairingMode() {
  // TODO(ble): Phase 1b 接入 NimBLE 配对广播。现占位：LED1 蓝快闪 2s 提示已触发。
  for (int i = 0; i < 8; ++i) {
    leds.setModeColor(0, 0, 120);
    delay(125);
    leds.setModeColor(0, 0, 0);
    delay(125);
  }
  leds.setModeColor(0, 60, 0);  // 恢复 USB 模式指示
}

static void checkLongPressActions() {
  // 裸机调试入口：模块 BOOT 键长按 3s（组装后难按，仅兜底）
  static uint32_t bootHeldSince = 0;
  static bool bootArmed = false;
  if (digitalRead(PIN_BOOT_KEY) == LOW) {
    if (!bootArmed) {
      bootArmed = true;
      bootHeldSince = millis();
    } else if (millis() - bootHeldSince >= BOOT_KEY_REFLASH_MS) {
      enterDownloadMode();
    }
  } else {
    bootArmed = false;
  }

  // 组装后主入口：侧键分级长按（直接读矩阵位，不经消抖层）
  static uint32_t sideHeldSince = 0;
  static bool sideArmed = false, pairingFired = false;
  if (matrix.rawKeyDown(SIDE_KEY_ROW, SIDE_KEY_COL)) {
    if (!sideArmed) {
      sideArmed = true;
      sideHeldSince = millis();
      pairingFired = false;
    }
    uint32_t held = millis() - sideHeldSince;
    if (held >= SIDE_HOLD_REFLASH_MS) {
      enterDownloadMode();
    } else if (held >= SIDE_HOLD_PAIRING_MS) {
      showSideHoldProgress(held);
      if (!pairingFired) {
        pairingFired = true;
        enterPairingMode();
      }
    } else {
      showSideHoldProgress(held);
    }
  } else if (sideArmed) {
    sideArmed = false;
    leds.setModeColor(0, 60, 0);  // 松手恢复 USB 模式指示
  }
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
