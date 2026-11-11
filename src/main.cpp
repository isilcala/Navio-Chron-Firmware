// Navio Chron firmware — 主程序
// 分层：输入扫描(input/) → 预设映射(mapping/) → 动作(action/) → HID 传输(hid/)
// 第一期：USB 传输；BLE 传输实现 ITransport 后在此切换/自动选择
#include <Arduino.h>

#include "Config.h"
#include "Pins.h"
#include "PresetManager.h"
#include "hid/BleTransport.h"
#include "hid/HidUsage.h"
#include "hid/ITransport.h"
#include "hid/UsbTransport.h"
#include "proto/ConfigProto.h"
#include "proto/VendorHid.h"
#include "ota/OtaManager.h"
#include "input/DownloadMode.h"
#include "input/Encoders.h"
#include "input/InputEvents.h"
#include "input/MatrixScanner.h"
#include "led/LedController.h"
#include "power/Battery.h"

using namespace navio;

extern "C" bool verifyRollbackLater() { return true; }

static MatrixScanner matrix;
static Encoders encoders;
static LedController leds;
static Battery battery;
static PresetManager presets;
static UsbTransport usbTransport;
static BleTransport bleTransport;
static ITransport* transport = &usbTransport;

// Phase 2 配置通道（Vendor HID，桌面端/WebHID 下发预设用）
static VendorHid vendorHid;
static ConfigProto configProto;
static OtaManager otaManager;

static Action s_buttonActions[BTN_COUNT];
static bool s_channelComboKeys[3] = {};

struct EncoderPulse {
  Action action;
  ITransport* transport;
  uint32_t releaseAtUs;
  int8_t wheelDy;
  bool wheelPending;
  bool active;
};
static EncoderPulse s_encoderPulses[8];

static void releaseAllActions() {
  transport->releaseAll();
  leds.releaseKeys();
  for (Action& action : s_buttonActions) action = Action{};
  for (EncoderPulse& pulse : s_encoderPulses) pulse.active = false;
  for (bool& comboKey : s_channelComboKeys) comboKey = false;
}

// 连接模式选择（D3）：USB 挂载优先；否则 BLE（已连=蓝 / 配对中蓝快闪 / 等待=橙闪）
static bool s_sideHoldActive = false;  // 侧键长按中：抑制状态灯刷新，让位于进度渐变
#if NAVIO_FORCE_BLE  // 未焊接阶段：连接状态镜像到单片机板载 RGB（键盘状态灯未焊接）
static void mirrorModeLed(uint8_t r, uint8_t g, uint8_t b) {
  leds.setModeColor(r, g, b);
  neopixelWrite(PIN_BOARD_RGB, r, g, b);
}
#else
static void mirrorModeLed(uint8_t r, uint8_t g, uint8_t b) { leds.setModeColor(r, g, b); }
#endif
static void updateBleModeLed() {
  if (bleTransport.isConnected()) {
    if (!s_sideHoldActive) mirrorModeLed(0, 0, 60);  // 蓝：BLE 已连接
  } else if (!s_sideHoldActive) {
    static bool blink = false;
    blink = !blink;
    if (bleTransport.isPairing()) {
      mirrorModeLed(0, 0, blink ? 100 : 0);  // 蓝快闪：配对中
    } else {
      mirrorModeLed(blink ? 50 : 0, blink ? 25 : 0, 0);  // 橙慢闪：等待连接
    }
  }
}

static void updateLinkMode() {
  static uint32_t lastCheck = 0;
  uint32_t now = millis();
  if (now - lastCheck < 200) return;
  lastCheck = now;

  ITransport* desired;
#if NAVIO_FORCE_BLE  // bring-up 试验构建：无视 USB，强制 BLE（未焊接无电池时验证蓝牙用）
  desired = &bleTransport;
  updateBleModeLed();
#else
  if (usbTransport.isConnected()) {
    desired = &usbTransport;
    if (!bleTransport.isPairing()) bleTransport.pauseAdvertising();  // 配对模式例外：USB 插着也保持可发现
    if (!s_sideHoldActive) mirrorModeLed(0, 60, 0);  // 绿：USB
  } else {
    bleTransport.resumeAdvertising();
    desired = &bleTransport;  // 未连接时发送自然丢弃
    updateBleModeLed();
  }
#endif
  if (desired != transport) {
    releaseAllActions();
    transport = desired;
  }
}

// 蓝牙电量上报：值变化立即推送（拔线/放电解锁 ≤5s 刷新），无变化 60s 心跳保底
static void updateBleBattery() {
  static uint32_t last = millis() - 60 * 1000;  // 上电即首发
  static uint8_t lastPct = 255;
  uint8_t pct = battery.percent();
  if (pct == lastPct && millis() - last < 60 * 1000) return;
  last = millis();
  lastPct = pct;
  bleTransport.updateBattery(pct);
}

static void dispatchButton(Btn id, bool pressed);
static void tickEncoderPulses();
static void checkLongPressActions();
static void switchPreset();

// 下载模式入口见 input/DownloadMode.h（BOOT 长按 3s，各固件共用）。
// 侧键（SW11, R1C1，全局保留键）：短按松手=切预设；侧键+K1/K2/K3=蓝牙频道；
// 按住 5s=当前频道配对；插电/复位时按住=烧写。配对前 LED1 蓝色渐亮。
constexpr uint8_t SIDE_KEY_ROW = 0, SIDE_KEY_COL = 0;
static bool s_sideComboUsed = false;
static void dispatchEncoder(Enc id, int8_t dir);

#if !NAVIO_IGNORE_MATRIX
static bool sideKeyHeldAtBoot() {
  uint32_t stableMs = 0;
  for (uint32_t elapsedMs = 0;
       elapsedMs < SIDE_BOOT_WINDOW_MS && stableMs < SIDE_BOOT_STABLE_MS;
       ++elapsedMs) {
    stableMs = matrix.rawKeyDown(SIDE_KEY_ROW, SIDE_KEY_COL) ? stableMs + 1 : 0;
    delay(1);
  }
  return stableMs >= SIDE_BOOT_STABLE_MS;
}
#endif

void setup() {
  // 主固件 CDC_ON_BOOT=0，Serial=UART0 无接收者；诊断构建走 USB-Serial/JTAG。
  Serial.begin(115200);

  // 板载 RGB 启动信标（未焊接阶段唯一的可视化调试手段）
  // 绿=进入setup 蓝=即将启动USB 青×3=全部完成
  neopixelWrite(PIN_BOARD_RGB, 0, 50, 0);
  delay(300);

  // 启动早期检查：连续稳定按住才进下载模式，避免单次毛刺误入
  matrix.begin();
#if !NAVIO_IGNORE_MATRIX  // 未焊接阶段侧键悬空，跳过（悬空误判会直接进下载模式）
  if (sideKeyHeldAtBoot()) {
    enterDownloadMode();
    return;  // 不会到达，保险
  }
#endif

  battery.begin();
  leds.begin();
  encoders.begin();
  presets.begin();
  pinMode(PIN_BOOT_KEY, INPUT_PULLUP);
  // matrix.begin() 已在启动早期完成（侧键下载模式检查），此处不重复

  neopixelWrite(PIN_BOARD_RGB, 0, 0, 50);  // 蓝：接下来是 USB 初始化
  delay(300);
  bool vendorReady = false;
#if !NAVIO_FORCE_BLE
  vendorReady = vendorHid.begin();
  if (vendorReady) {
    configProto.begin(&vendorHid, &presets, &otaManager, &bleTransport, releaseAllActions, [] {
      leds.showPreset(presets.active().accent, presets.active().rgbMode);
    });
  } else {
    Serial.println("[Navio] Vendor HID interface registration failed");
  }
  usbTransport.begin();  // HID 就绪后才开始产生输入事件
#endif
  bleTransport.begin();  // BLE 常开（自动重连已配对主机；广播由 updateLinkMode 调度）
  if (otaManager.runningImageState() == OtaImageState::PendingVerify) {
    if (vendorReady && presets.count() > 0) {
      OtaImageState confirmed;
      if (otaManager.confirm(confirmed) != OtaError::None) {
        Serial.println("[Navio] OTA self-test confirm failed");
      }
    } else {
      Serial.println("[Navio] OTA self-test failed, image left pending");
    }
  }
  leds.showPreset(presets.active().accent, presets.active().rgbMode);
  // 板载 RGB 闪三下青色 = 启动完成信标（未焊接阶段的肉眼确认手段）
  for (int i = 0; i < 3; ++i) {
    neopixelWrite(PIN_BOARD_RGB, 0, 60, 60);
    delay(120);
    neopixelWrite(PIN_BOARD_RGB, 0, 0, 0);
    delay(120);
  }
}

void loop() {
  bleTransport.poll();
  tickEncoderPulses();

  // 1ms 输入轮询（矩阵整轮 + 编码器全量 <100µs）
  static uint32_t lastPollUs = 0;
  uint32_t nowUs = micros();
  if (nowUs - lastPollUs >= INPUT_POLL_INTERVAL_US) {
    lastPollUs = nowUs;

    matrix.poll();
    if (uint16_t dropped = matrix.takeDroppedEvents()) {
      releaseAllActions();
      Serial.printf("[Navio] matrix event queue overflow: %u dropped\n", dropped);
    }
    bool otaBusy = otaManager.isBusy();
    BtnEvent be;
    while (matrix.next(be)) {
      if (!otaBusy) dispatchButton(be.id, be.pressed);
    }

    encoders.poll();
    if (uint16_t dropped = encoders.takeDroppedEvents()) {
      Serial.printf("[Navio] encoder event queue overflow: %u dropped\n", dropped);
    }
    EncoderEvent ee;
    while (encoders.next(ee)) {
      if (!otaBusy) dispatchEncoder(ee.id, ee.dir);
    }
  }

  // 低频任务
  vendorHid.poll();
  configProto.poll();
  battery.tick();
  leds.setBatteryLow(battery.low());
  leds.tick();
  updateLinkMode();
  updateBleBattery();
  checkLongPressActions();

  delay(1);  // 让出 CPU（避免忙转饿死其他任务）
}

// 侧键长按进度 → 模式灯颜色：0-5s 蓝色渐亮，到位后由配对状态灯接管
static void showSideHoldProgress(uint32_t heldMs) {
  uint8_t b = 20 + (uint8_t)(100 * heldMs / SIDE_HOLD_PAIRING_MS);
  mirrorModeLed(0, 0, b);
}

static void selectBluetoothChannel(uint8_t channel) {
  if (channel == bleTransport.currentChannel()) return;
  bleTransport.selectChannel(channel);
  leds.showChannelFeedback(channel);
}

static void enterPairingMode() {
  bleTransport.enterPairing();
}

static void checkLongPressActions() {
  // 裸机调试入口：模块 BOOT 键长按 3s=烧写（组装后难按，仅兜底）；
  // 短按=当前传输发测试键 'a'（未焊接阶段的 BLE 链路验证手段）
  static uint32_t bootHeldSince = 0;
  static bool bootArmed = false;
  if (digitalRead(PIN_BOOT_KEY) == LOW) {
    if (!bootArmed) {
      bootArmed = true;
      bootHeldSince = millis();
    } else if (millis() - bootHeldSince >= BOOT_KEY_REFLASH_MS) {
      enterDownloadMode();
    }
  } else if (bootArmed) {
    bootArmed = false;
    if (millis() - bootHeldSince < BOOT_KEY_REFLASH_MS) {
      // 测试键：短按 = 发送 'a'（未焊接阶段的输入链路验证）。
      // 灯反馈：当前传输为 BLE 时按 notify 结果绿/红；USB 无返回值恒绿。
      // 清绑定入口 = 侧键长按 5s（配对模式，组装后）
      transport->pressChord(MOD_NONE, HID_A);
      bool ok = (transport == &bleTransport) ? bleTransport.lastSendOk() : true;
      neopixelWrite(PIN_BOARD_RGB, ok ? 0 : 60, ok ? 60 : 0, 0);
      delay(300);
      transport->releaseChord(MOD_NONE, HID_A);
    }
  }

  // 侧键单击/长按（直接读矩阵位，不经消抖层）
  static uint32_t sideHeldSince = 0;
  static bool sideArmed = false;
  static bool sideLongPressHandled = false;
#if NAVIO_IGNORE_MATRIX  // 未焊接阶段：侧键悬空，跳过长按检测（BOOT 键仍可用）
  if (false) {
#endif
  if (matrix.rawKeyDown(SIDE_KEY_ROW, SIDE_KEY_COL)) {
    if (!sideArmed) {
      sideArmed = true;
      sideHeldSince = millis();
      sideLongPressHandled = false;
      s_sideComboUsed = false;
    }
    uint32_t held = millis() - sideHeldSince;
    if (!sideLongPressHandled && !s_sideComboUsed) {
      if (held >= SIDE_HOLD_PAIRING_MS) {
        sideLongPressHandled = true;
        s_sideHoldActive = false;
        if (!otaManager.isBusy()) enterPairingMode();
      } else {
        s_sideHoldActive = true;
        showSideHoldProgress(held);
      }
    }
  } else if (sideArmed) {
    uint32_t held = millis() - sideHeldSince;
    sideArmed = false;
    s_sideHoldActive = false;  // 松手后状态灯由 updateLinkMode 在 200ms 内自动恢复
    if (!s_sideComboUsed && !sideLongPressHandled &&
        held < SIDE_HOLD_PAIRING_MS && !otaManager.isBusy()) {
      switchPreset();
    }
    s_sideComboUsed = false;
  }
#if NAVIO_IGNORE_MATRIX
  }
#endif
}

static void switchPreset() {
  // 切预设前清空按键状态，避免旧和弦残留
  releaseAllActions();
  presets.cycle();
  leds.showPreset(presets.active().accent, presets.active().rgbMode);
  Serial.printf("[Navio] preset -> %s\n", presets.active().name);
}

static void dispatchButton(Btn id, bool pressed) {
#if NAVIO_IGNORE_MATRIX  // 未焊接阶段：矩阵悬空引脚噪声事件全部丢弃
  (void)id;
  (void)pressed;
  return;
#endif
  const size_t index = static_cast<size_t>(id);
  if (index < 3 && (matrix.rawKeyDown(SIDE_KEY_ROW, SIDE_KEY_COL) || s_channelComboKeys[index])) {
    if (pressed && !s_channelComboKeys[index]) {
      s_channelComboKeys[index] = true;
      s_sideComboUsed = true;
      s_sideHoldActive = false;
      selectBluetoothChannel(static_cast<uint8_t>(index));
    } else if (!pressed) {
      s_channelComboKeys[index] = false;
    }
    return;
  }
  if (id == Btn::SideKey) return;  // 短按/长按统一由 checkLongPressActions 裁决
  if (id <= Btn::K12) leds.setKeyPressed(static_cast<uint8_t>(id), pressed);
  if (pressed) {
    if (s_buttonActions[index]) return;
    s_buttonActions[index] = presets.active().btn[index];
  }
  const Action a = s_buttonActions[index];
  if (!pressed) s_buttonActions[index] = Action{};
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
        transport->consumerRelease(a.code);
      break;
    default:
      break;
  }
}

static void startEncoderPulse(const Action& action, int8_t wheelDy = 0) {
  EncoderPulse* slot = nullptr;
  for (EncoderPulse& pulse : s_encoderPulses) {
    if (!pulse.active) {
      slot = &pulse;
      break;
    }
  }
  if (!slot) {
    releaseAllActions();
    Serial.println("[Navio] encoder pulse queue overflow");
    return;
  }

  slot->action = action;
  slot->transport = transport;
  slot->releaseAtUs = micros() + ENCODER_PULSE_US;
  slot->wheelDy = wheelDy;
  slot->wheelPending = wheelDy != 0;
  slot->active = true;
  if (action.kind == Action::KeyChord) {
    transport->pressChord(action.mods, action.code);
  } else if (action.kind == Action::Consumer) {
    transport->consumerPress(action.code);
  }
}

static void tickEncoderPulses() {
  uint32_t now = micros();
  for (EncoderPulse& pulse : s_encoderPulses) {
    if (!pulse.active || static_cast<int32_t>(now - pulse.releaseAtUs) < 0) continue;
    ITransport* pulseTransport = pulse.transport;
    if (pulse.wheelPending) {
      pulse.wheelPending = false;
      pulse.releaseAtUs = now + ENCODER_PULSE_US;
      pulseTransport->mouseWheel(pulse.wheelDy);
      continue;
    }

    Action action = pulse.action;
    pulse.active = false;
    if (action.kind == Action::KeyChord) {
      pulseTransport->releaseChord(action.mods, action.code);
    } else if (action.kind == Action::Consumer) {
      pulseTransport->consumerRelease(action.code);
    }
  }
}

static void dispatchEncoder(Enc id, int8_t dir) {
#if NAVIO_IGNORE_MATRIX  // 未焊接阶段：编码器悬空噪声同样丢弃
  (void)id;
  (void)dir;
  return;
#endif
  const Action& a = presets.active().enc[static_cast<size_t>(id)][dir > 0 ? 0 : 1];
  if (!a) return;
  switch (a.kind) {
    case Action::KeyChord:
    case Action::Consumer:
      startEncoderPulse(a);
      break;
    case Action::Wheel:
      if (a.mods) {  // 先让主机处理修饰键，再发滚轮，避免独立 USB 接口乱序
        startEncoderPulse(actKey(a.mods, 0), a.wheelDy);
      } else {
        transport->mouseWheel(a.wheelDy);
      }
      break;
    default:
      break;
  }
}
