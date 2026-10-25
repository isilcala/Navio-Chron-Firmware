#include "hid/BleTransport.h"

#if ESP_ARDUINO_VERSION_MAJOR >= 3
#include <NimBLEDevice.h>
#include <NimBLEHIDDevice.h>
#else
#include <NimBLEDevice.h>
#include <NimBLEHIDDevice.h>
#endif

#include "hid/HidUsage.h"

namespace navio {

// ---------------------------------------------------------------------------
// HID Report Map：键盘(报告1) + 消费控制(报告2)。
// 逐字节采用 HijelHID（NimBLE 2.3.8+）已验证可用的描述符——HID 描述符的细微
// 偏差主机栈不会报错，只会静默丢弃报告（D12 教训）。
// 鼠标(报告3)暂缓：键盘/消费验证稳定后按同风格加回。
// ---------------------------------------------------------------------------
static const uint8_t kReportMap[] = {
    // ── Keyboard (Report ID 0x01) ──────────────────────────────────────
    0x05, 0x01,        // Usage Page (Generic Desktop)
    0x09, 0x06,        // Usage (Keyboard)
    0xA1, 0x01,        // Collection (Application)
    0x85, 0x01,        //   Report ID (1)
    0x05, 0x07,        //   Usage Page (Key Codes)
    0x19, 0xE0,        //   Usage Minimum (Left Control)
    0x29, 0xE7,        //   Usage Maximum (Right GUI)
    0x15, 0x00,        //   Logical Minimum (0)
    0x25, 0x01,        //   Logical Maximum (1)
    0x75, 0x01,        //   Report Size (1 bit)
    0x95, 0x08,        //   Report Count (8)
    0x81, 0x02,        //   Input (Data, Variable, Absolute) — modifier byte
    0x95, 0x01,        //   Report Count (1)
    0x75, 0x08,        //   Report Size (8 bits)
    0x81, 0x01,        //   Input (Constant) — reserved byte
    0x95, 0x05,        //   Report Count (5)
    0x75, 0x01,        //   Report Size (1 bit)
    0x05, 0x08,        //   Usage Page (LEDs)
    0x19, 0x01,        //   Usage Minimum (Num Lock)
    0x29, 0x05,        //   Usage Maximum (Kana)
    0x91, 0x02,        //   Output (Data, Variable, Absolute)
    0x95, 0x01,        //   Report Count (1)
    0x75, 0x03,        //   Report Size (3 bits)
    0x91, 0x01,        //   Output (Constant) — padding
    0x95, 0x06,        //   Report Count (6)
    0x75, 0x08,        //   Report Size (8 bits)
    0x15, 0x00,        //   Logical Minimum (0)
    0x26, 0xE7, 0x00,  //   Logical Maximum (0xE7)
    0x05, 0x07,        //   Usage Page (Key Codes)
    0x19, 0x00,        //   Usage Minimum (0)
    0x2A, 0xE7, 0x00,  //   Usage Maximum (0xE7)
    0x81, 0x00,        //   Input (Data, Array, Absolute) — 6-key rollover
    0xC0,              // End Collection (Keyboard)
    // ── Consumer Control (Report ID 0x02) ─────────────────────────────
    0x05, 0x0C,        // Usage Page (Consumer)
    0x09, 0x01,        // Usage (Consumer Control)
    0xA1, 0x01,        // Collection (Application)
    0x85, 0x02,        //   Report ID (2)
    0x15, 0x00,        //   Logical Minimum (0)
    0x26, 0xFF, 0x03,  //   Logical Maximum (0x3FF)
    0x19, 0x00,        //   Usage Minimum (0)
    0x2A, 0xFF, 0x03,  //   Usage Maximum (0x3FF)
    0x75, 0x10,        //   Report Size (16 bits)
    0x95, 0x01,        //   Report Count (1)
    0x81, 0x00,        //   Input (Data, Array, Absolute)
    0xC0,              // End Collection (Consumer Control)
};

static NimBLEServer* server = nullptr;
static NimBLEHIDDevice* hid = nullptr;
static NimBLECharacteristic* chrKeyboard = nullptr;  // 报告 1
static NimBLECharacteristic* chrConsumer = nullptr;  // 报告 2

static BleTransport* s_self = nullptr;

// NimBLE 回调签名随版本不同：2.x 用 NimBLEConnInfo&，1.4.x 用 ble_gap_conn_desc*
#if ESP_ARDUINO_VERSION_MAJOR >= 3
class ServerCallbacks : public NimBLEServerCallbacks {
 public:
  void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override {
    (void)pServer;
    if (s_self) s_self->onConnect_(connInfo.getConnHandle());
  }
  void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason) override {
    (void)pServer;
    (void)connInfo;
    (void)reason;
    if (s_self) s_self->onDisconnect_();
  }
};
#else
class ServerCallbacks : public NimBLEServerCallbacks {
 public:
  void onConnect(NimBLEServer* pServer, ble_gap_conn_desc* desc) override {
    (void)pServer;
    if (s_self) s_self->onConnect_(desc ? desc->conn_handle : 0);
  }
  void onDisconnect(NimBLEServer* pServer, ble_gap_conn_desc* desc) override {
    (void)pServer;
    (void)desc;
    if (s_self) s_self->onDisconnect_();
  }
};
#endif

void BleTransport::begin() {
  s_self = this;
  NimBLEDevice::init("Navio Chron");
  NimBLEDevice::setSecurityAuth(/*bond*/ true, /*mitm*/ false, /*secure conn*/ true);

  server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks(), false);
#if ESP_ARDUINO_VERSION_MAJOR < 3
  // 1.4.x：断开后默认自动定向广播（只有旧绑定主机可见），改为普通广播由 onDisconnect_ 接管
  server->advertiseOnDisconnect(false);
#endif

  hid = new NimBLEHIDDevice(server);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  hid->setManufacturer("Navio");
  hid->setPnp(0x01, 0x02E5, 0xBEEF, 0x0100);  // SIG source + Espressif VID
  hid->setHidInfo(0x00, 0x01);
  hid->setReportMap(const_cast<uint8_t*>(kReportMap), sizeof(kReportMap));
#else
  hid->manufacturer("Navio");
  hid->pnp(0x01, 0x02E5, 0xBEEF, 0x0100);
  hid->hidInfo(0x00, 0x01);
  hid->reportMap(const_cast<uint8_t*>(kReportMap), sizeof(kReportMap));
#endif
  hid->setBatteryLevel(100);

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  chrKeyboard = hid->getInputReport(1);
  chrConsumer = hid->getInputReport(2);
#else
  chrKeyboard = hid->inputReport(1);
  chrConsumer = hid->inputReport(2);
  hid->startServices();  // 1.4.x 必须显式启动服务（2.x 由 server.start() 接管）
#endif
  // 鼠标(报告3)：描述符稳定后按同风格加回

  NimBLEAdvertising* adv = server->getAdvertising();
  adv->setAppearance(0x03C1);  // HID Keyboard
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  adv->addServiceUUID(hid->getHidService()->getUUID());
  adv->addServiceUUID(hid->getBatteryService()->getUUID());
  adv->setPreferredParams(0x10, 0x20);  // 连接参数 20-40ms（Android 11 兼容）
  adv->enableScanResponse(true);
#else
  adv->addServiceUUID(hid->hidService()->getUUID());
  adv->addServiceUUID(hid->batteryService()->getUUID());
  adv->setMinPreferred(0x10);
#endif
  // 设备名放 scan response：主机蓝牙设置才能正确显示 "Navio Chron"（Android 必需）
  NimBLEAdvertisementData scanResp;
  scanResp.setName("Navio Chron");
  adv->setScanResponseData(scanResp);
  adv->start();
  advertising_ = true;
}

void BleTransport::onConnect_(uint16_t connHandle) {
  connected_ = true;
  connHandle_ = connHandle;  // 供配对模式主动断开当前连接
  advertising_ = false;
  primed_ = false;  // 新连接需要重新预热（首帧 notify 会被主机握手期丢弃）
}

void BleTransport::onDisconnect_() {
  connected_ = false;
  // 自动恢复普通广播等待重连（USB 优先时段由 main 调 pause 压制）
  if (server && !advertising_) {
    server->getAdvertising()->start();
    advertising_ = true;
  }
}

void BleTransport::enterPairing() {
  // 清除全部绑定并重新进入可发现/可配对状态（换主机/跨库版本升级后残留 bond 不兼容时用）
  if (connected_ && server) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    server->disconnect(connHandle_);
#else
    server->disconnect(connHandle_);
#endif
  }
  NimBLEDevice::deleteAllBonds();
  if (server) {
    server->getAdvertising()->start();
    advertising_ = true;
  }
}

void BleTransport::pauseAdvertising() {
  if (advertising_ && server) {
    server->getAdvertising()->stop();
    advertising_ = false;
  }
}

void BleTransport::resumeAdvertising() {
  if (!advertising_ && !connected_ && server) {
    server->getAdvertising()->start();
    advertising_ = true;
  }
}

void BleTransport::updateBattery(uint8_t pct) {
  if (hid) hid->setBatteryLevel(pct);
}

// —— 报告发送 ——//

int BleTransport::kbSlotFor_(uint16_t usage, bool allocate) {
  for (int i = 0; i < 6; ++i) {
    if (kbKeys_[i] == usage) return i;
    if (allocate && kbKeys_[i] == 0) return i;
  }
  return -1;  // 6 键全满（标准键盘限制）
}

// 键盘报告为纯 8 字节（mods+reserved+6键），不带 Report ID 前缀
// （Report Reference descriptor 已标明报告归属；对照 HijelHID 验证实现）
void BleTransport::sendKeyboardReport_() {
  if (!chrKeyboard || !connected_) {
    lastNotifyOk_ = false;
    return;
  }
  // 预热：连接后首帧 notify 会被主机握手期丢弃，先发空报告垫场
  if (!primed_) {
    primed_ = true;
    uint8_t empty[8] = {};
    chrKeyboard->setValue(empty, 8);
    chrKeyboard->notify();
    delay(50);
  }
  uint8_t report[8] = {kbMods_, 0, 0, 0, 0, 0, 0, 0};
  memcpy(report + 2, kbKeys_, 6);
  chrKeyboard->setValue(report, sizeof(report));
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  lastNotifyOk_ = chrKeyboard->notify();
#else
  chrKeyboard->notify();  // NimBLE 1.4 notify 无返回值
  lastNotifyOk_ = true;
#endif
}

void BleTransport::pressChord(uint8_t modMask, uint16_t usage) {
  kbMods_ |= modMask;
  if (usage) {
    int slot = kbSlotFor_(static_cast<uint8_t>(usage), true);
    if (slot < 0) return;  // 6 键全满
    kbKeys_[slot] = static_cast<uint8_t>(usage);  // 键码写入槽位（缺此行=发送全零报告）
  }
  sendKeyboardReport_();
}

void BleTransport::releaseChord(uint8_t modMask, uint16_t usage) {
  kbMods_ &= ~modMask;
  if (usage) {
    int slot = kbSlotFor_(static_cast<uint8_t>(usage), false);
    if (slot >= 0) kbKeys_[slot] = 0;
  }
  sendKeyboardReport_();
}

void BleTransport::releaseAll() {
  kbMods_ = 0;
  memset(kbKeys_, 0, sizeof(kbKeys_));
  sendKeyboardReport_();
  consumerRelease();
}

void BleTransport::consumerPress(uint16_t usage) {
  if (!chrConsumer || !connected_) return;
  uint8_t report[2] = {static_cast<uint8_t>(usage & 0xFF),
                       static_cast<uint8_t>(usage >> 8)};
  chrConsumer->setValue(report, 2);
  chrConsumer->notify();
}

void BleTransport::consumerRelease() {
  if (!chrConsumer || !connected_) return;
  uint8_t report[2] = {0, 0};
  chrConsumer->setValue(report, 2);
  chrConsumer->notify();
}

void BleTransport::mouseWheel(int8_t dy) {
  (void)dy;
  // TODO(ble): 鼠标报告(3)待描述符加入后实现
}

}  // namespace navio
