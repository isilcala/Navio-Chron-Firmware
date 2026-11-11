#include "hid/BleTransport.h"

#include <NimBLEDevice.h>
#include <NimBLEHIDDevice.h>

#include "hid/HidUsage.h"

namespace navio {

// ---------------------------------------------------------------------------
// HID Report Map：键盘(报告1) + 消费控制(报告2) + 鼠标(报告3)。
// 逐字节采用 HijelHID（NimBLE 2.3.8+）已验证可用的描述符——HID 描述符的细微
// 偏差主机栈不会报错，只会静默丢弃报告（D12 教训）。
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
    // ── Mouse (Report ID 0x03)：3 键 + X/Y/滚轮（相对值） ──────────────
    0x05, 0x01,        // Usage Page (Generic Desktop)
    0x09, 0x02,        // Usage (Mouse)
    0xA1, 0x01,        // Collection (Application)
    0x09, 0x01,        //   Usage (Pointer)
    0xA1, 0x00,        //   Collection (Physical)
    0x85, 0x03,        //     Report ID (3)
    0x05, 0x09,        //     Usage Page (Button)
    0x19, 0x01,        //     Usage Minimum (1)
    0x29, 0x03,        //     Usage Maximum (3)
    0x15, 0x00,        //     Logical Minimum (0)
    0x25, 0x01,        //     Logical Maximum (1)
    0x95, 0x03,        //     Report Count (3)
    0x75, 0x01,        //     Report Size (1 bit)
    0x81, 0x02,        //     INPUT (Data, Variable, Absolute)
    0x95, 0x01,        //     Report Count (1)
    0x75, 0x05,        //     Report Size (5 bits)
    0x81, 0x03,        //     INPUT (Constant) — padding
    0x05, 0x01,        //     Usage Page (Generic Desktop)
    0x09, 0x30,        //     Usage (X)
    0x09, 0x31,        //     Usage (Y)
    0x09, 0x38,        //     Usage (Wheel)
    0x15, 0x81,        //     Logical Minimum (-127)
    0x25, 0x7F,        //     Logical Maximum (127)
    0x75, 0x08,        //     Report Size (8 bits)
    0x95, 0x03,        //     Report Count (3)
    0x81, 0x06,        //     INPUT (Data, Variable, Relative)
    0xC0,              //   End Collection (Physical)
    0xC0,              // End Collection (Mouse)
};

static NimBLEServer* server = nullptr;
static NimBLEHIDDevice* hid = nullptr;
static NimBLECharacteristic* chrKeyboard = nullptr;  // 报告 1
static NimBLECharacteristic* chrConsumer = nullptr;  // 报告 2
static NimBLECharacteristic* chrMouse = nullptr;     // 报告 3

static BleTransport* s_self = nullptr;

BleBondAddress fromNimBLEAddress(const NimBLEAddress& address) {
  BleBondAddress result;
  result.type = address.getType();
  memcpy(result.value, address.getVal(), sizeof(result.value));
  return result;
}

NimBLEAddress toNimBLEAddress(const BleBondAddress& address) {
  ble_addr_t native;
  native.type = address.type;
  memcpy(native.val, address.value, sizeof(native.val));
  return NimBLEAddress(native);
}

bool sameAddress(const BleBondAddress& a, const BleBondAddress& b) {
  return a.type == b.type && memcmp(a.value, b.value, sizeof(a.value)) == 0;
}

void bondMetadataKey(const BleBondAddress& address, char out[16]) {
  snprintf(out, 16, "u%02X%02X%02X%02X%02X%02X%02X", address.type,
           address.value[0], address.value[1], address.value[2],
           address.value[3], address.value[4], address.value[5]);
}

class BondStoreCallbacks : public NimBLEDeviceCallbacks {
 public:
  int onStoreStatus(struct ble_store_status_event* event, void* arg) override {
    (void)arg;
    if (event->event_code == BLE_STORE_EVENT_FULL) return 0;
    return BLE_HS_ENOMEM;
  }
};

static BondStoreCallbacks bondStoreCallbacks;

class ServerCallbacks : public NimBLEServerCallbacks {
 public:
  void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override {
    (void)pServer;
    if (s_self) s_self->onConnect_(connInfo);
  }
  void onIdentity(NimBLEConnInfo& connInfo) override {
    if (s_self) s_self->onPeerSecurity_(connInfo);
  }
  void onAuthenticationComplete(NimBLEConnInfo& connInfo) override {
    if (s_self) s_self->onPeerSecurity_(connInfo);
  }
  void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason) override {
    (void)pServer;
    if (s_self) s_self->onDisconnect_(connInfo.getConnHandle(), reason);
  }
};

class ReportCallbacks : public NimBLECharacteristicCallbacks {
 public:
  explicit ReportCallbacks(uint8_t reportId) : reportId_(reportId) {}

  void onSubscribe(NimBLECharacteristic* characteristic, NimBLEConnInfo& connInfo,
                   uint16_t subValue) override {
    (void)characteristic;
    if (s_self) s_self->onSubscribe_(connInfo, reportId_, subValue);
  }

 private:
  uint8_t reportId_;
};

void BleTransport::begin() {
  s_self = this;
  eventQueue_ = xQueueCreate(16, sizeof(Event));
  if (!eventQueue_) {
    Serial.println("[Navio] BLE event queue allocation failed");
    return;
  }

  NimBLEDevice::init("Navio Chron");
  NimBLEDevice::setDeviceCallbacks(&bondStoreCallbacks);
  NimBLEDevice::setSecurityAuth(/*bond*/ true, /*mitm*/ false, /*secure conn*/ true);

  server = NimBLEDevice::createServer();
  server->advertiseOnDisconnect(false);
  server->setCallbacks(new ServerCallbacks(), false);

  hid = new NimBLEHIDDevice(server);
  hid->setManufacturer("Navio");
  hid->setPnp(0x01, 0x02E5, 0xBEEF, 0x0100);  // SIG source + Espressif VID
  hid->setHidInfo(0x00, 0x01);
  hid->setReportMap(const_cast<uint8_t*>(kReportMap), sizeof(kReportMap));
  hid->setBatteryLevel(100);

  static ReportCallbacks keyboardCallbacks(1);
  static ReportCallbacks consumerCallbacks(2);
  static ReportCallbacks mouseCallbacks(3);
  chrKeyboard = hid->getInputReport(1);
  chrConsumer = hid->getInputReport(2);
  chrMouse = hid->getInputReport(3);
  chrKeyboard->setCallbacks(&keyboardCallbacks);
  chrConsumer->setCallbacks(&consumerCallbacks);
  chrMouse->setCallbacks(&mouseCallbacks);

  NimBLEAdvertising* adv = server->getAdvertising();
  adv->setAppearance(0x03C1);  // HID Keyboard
  adv->addServiceUUID(hid->getHidService()->getUUID());
  adv->addServiceUUID(hid->getBatteryService()->getUUID());
  adv->setPreferredParams(0x06, 0x06);  // 首选连接间隔 7.5ms；实际参数由主机决定
  adv->enableScanResponse(true);
  // 设备名放 scan response：主机蓝牙设置才能正确显示 "Navio Chron"（Android 必需）
  NimBLEAdvertisementData scanResp;
  scanResp.setName("Navio Chron");
  adv->setScanResponseData(scanResp);

  static_assert(sizeof(BleBondAddress) == 7, "BLE bond address must remain packed");
  bondPrefs_.begin("navio_ble", true);
  lastUsedSeq_ = bondPrefs_.getUInt("seq", 0);
  if (bondPrefs_.getBytesLength("last") == sizeof(BleBondAddress)) {
    bondPrefs_.getBytes("last", &lastUsedPeer_, sizeof(BleBondAddress));
  }
  bondPrefs_.end();
  loadChannels_();
  updateAdvertising_();
}

void BleTransport::postEvent_(const Event& event) {
  if (!eventQueue_ || xQueueSend(eventQueue_, &event, 0) != pdTRUE) {
    droppedEvents_.fetch_add(1, std::memory_order_relaxed);
  }
}

void BleTransport::onConnect_(const NimBLEConnInfo& connInfo) {
  postEvent_(Event{EventType::Connect, connInfo.getConnHandle(), 0, 0,
                   fromNimBLEAddress(connInfo.getIdAddress()),
                   fromNimBLEAddress(connInfo.getAddress())});
}

void BleTransport::onPeerSecurity_(const NimBLEConnInfo& connInfo) {
  postEvent_(Event{EventType::Security, connInfo.getConnHandle(), 0, 0,
                   fromNimBLEAddress(connInfo.getIdAddress()),
                   fromNimBLEAddress(connInfo.getAddress())});
}

void BleTransport::onDisconnect_(uint16_t connHandle, int reason) {
  postEvent_(Event{EventType::Disconnect, connHandle, 0, static_cast<uint16_t>(reason), {}, {}});
}

void BleTransport::onSubscribe_(const NimBLEConnInfo& connInfo, uint8_t reportId, uint16_t subValue) {
  postEvent_(Event{EventType::Subscribe, connInfo.getConnHandle(), reportId, subValue,
                   fromNimBLEAddress(connInfo.getIdAddress()),
                   fromNimBLEAddress(connInfo.getAddress())});
}

void BleTransport::poll() {
  if (uint32_t dropped = droppedEvents_.exchange(0, std::memory_order_relaxed)) {
    Serial.printf("[Navio] BLE event queue overflow: %lu dropped\n",
                  static_cast<unsigned long>(dropped));
  }

  Event event;
  while (eventQueue_ && xQueueReceive(eventQueue_, &event, 0) == pdTRUE) {
    if (event.type != EventType::Disconnect) {
      bool knownHost = wasBondedAtPairingStart_(event.peerAddress) ||
                       wasBondedAtPairingStart_(event.otaAddress) ||
                       isChannelBonded_(event.peerAddress) || isChannelBonded_(event.otaAddress);
      bool reject = pairingMode_ ? knownHost
                                : !(isSelectedHost_(event.peerAddress) ||
                                    isSelectedHost_(event.otaAddress));
      if (reject) {
        advertising_ = false;
        if (connected_ && event.connHandle == connHandle_) {
          subscriptions_ = 0;
          state_.releaseAll();
        }
        server->disconnect(event.connHandle);
        continue;
      }
    }
    switch (event.type) {
      case EventType::Connect:
        state_.releaseAll();
        subscriptions_ = 0;
        primed_ = false;
        connected_ = true;
        connHandle_ = event.connHandle;
        peerAddress_ = event.peerAddress;
        advertising_ = false;
        break;
      case EventType::Security:
        if (connected_ && event.connHandle == connHandle_ &&
            !toNimBLEAddress(event.peerAddress).isNull()) {
          peerAddress_ = event.peerAddress;
        }
        break;
      case EventType::Disconnect:
        if (!connected_) {
          advertising_ = false;
          updateAdvertising_();
          break;
        }
        if (event.connHandle != connHandle_) break;
        connected_ = false;
        subscriptions_ = 0;
        peerAddress_ = {};
        state_.releaseAll();
        updateAdvertising_();
        break;
      case EventType::Subscribe:
        if (!connected_ || event.connHandle != connHandle_ ||
            event.reportId < 1 || event.reportId > 3) {
          break;
        }
        if (event.subValue & 1) {
          subscriptions_ |= 1U << (event.reportId - 1);
        } else {
          subscriptions_ &= ~(1U << (event.reportId - 1));
        }
        if (subscriptions_) {
          if (pairingBondCount_ == 1 &&
              !sameAddress(pairingBonds_[0], peerAddress_)) {
            deleteBond(pairingBonds_[0]);
          }
          channelAddresses_[currentChannel_] = peerAddress_;
          saveChannel_(currentChannel_);
          pairingBondCount_ = 0;
          pairingMode_ = false;
          markBondUsed_();
        }
        break;
    }
  }
}

void BleTransport::updateAdvertising_() {
  if (!server) return;
  bool shouldAdvertise = advertisingWanted_ && !connected_;
  if (shouldAdvertise == advertising_) return;
  if (!shouldAdvertise) {
    server->getAdvertising()->stop();
    advertising_ = false;
    return;
  }

  BleBondAddress selected = channelAddresses_[currentChannel_];
  bool useWhitelist = !pairingMode_ && !toNimBLEAddress(selected).isNull();
  configureConnectionFilter_(useWhitelist, selected);
  advertising_ = server->getAdvertising()->start();
}

void BleTransport::restartAdvertising_() {
  if (server) server->getAdvertising()->stop();
  advertising_ = false;
  updateAdvertising_();
}

void BleTransport::configureConnectionFilter_(bool enable, const BleBondAddress& address) {
  NimBLEAdvertising* advertising = server->getAdvertising();
  bool ok = true;
  while (NimBLEDevice::getWhiteListCount() > 0) {
    if (!NimBLEDevice::whiteListRemove(NimBLEDevice::getWhiteListAddress(0))) {
      ok = false;
      break;
    }
  }
  if (ok && enable) ok = NimBLEDevice::whiteListAdd(toNimBLEAddress(address));
  if (!ok) Serial.println("[Navio] BLE whitelist update failed; advertising without connection filter");
  advertising->setScanFilter(false, ok && enable);
}

bool BleTransport::enterPairing() {
  BleBondAddress selected = channelAddresses_[currentChannel_];
  pairingBondCount_ = toNimBLEAddress(selected).isNull() ? 0 : 1;
  if (pairingBondCount_ == 1) pairingBonds_[0] = selected;
  pairingMode_ = true;
  advertisingWanted_ = true;
  if (connected_ && server) {
    releaseAll();
    server->disconnect(connHandle_);
  }
  restartAdvertising_();
  return true;
}

void BleTransport::selectChannel(uint8_t channel) {
  if (channel >= BLE_BOND_MAX || channel == currentChannel_) return;
  currentChannel_ = channel;
  saveCurrentChannel_();
  pairingBondCount_ = 0;
  pairingMode_ = toNimBLEAddress(channelAddresses_[currentChannel_]).isNull();
  if (connected_ && server) {
    releaseAll();
    server->disconnect(connHandle_);
  }
  restartAdvertising_();
}

bool BleTransport::isChannelBonded_(const BleBondAddress& address) const {
  if (toNimBLEAddress(address).isNull()) return false;
  for (const BleBondAddress& channel : channelAddresses_) {
    if (sameAddress(channel, address)) return true;
  }
  return false;
}

bool BleTransport::isSelectedHost_(const BleBondAddress& address) const {
  return !toNimBLEAddress(channelAddresses_[currentChannel_]).isNull() &&
         sameAddress(channelAddresses_[currentChannel_], address);
}

void BleTransport::loadChannels_() {
  bool present[BLE_BOND_MAX] = {};
  bondPrefs_.begin("navio_ble", true);
  currentChannel_ = bondPrefs_.getUChar("cur", 0);
  if (currentChannel_ >= BLE_BOND_MAX) currentChannel_ = 0;
  for (uint8_t i = 0; i < BLE_BOND_MAX; ++i) {
    char key[6];
    snprintf(key, sizeof(key), "ch%u", i);
    if (bondPrefs_.getBytesLength(key) == sizeof(BleBondAddress)) {
      bondPrefs_.getBytes(key, &channelAddresses_[i], sizeof(BleBondAddress));
      present[i] = true;
    }
  }
  bondPrefs_.end();

  for (uint8_t i = 0; i < BLE_BOND_MAX; ++i) {
    if (!present[i] && i < bondCount()) {
      channelAddresses_[i] = fromNimBLEAddress(NimBLEDevice::getBondedAddress(i));
      saveChannel_(i);
    } else if (present[i] && !toNimBLEAddress(channelAddresses_[i]).isNull() &&
               !NimBLEDevice::isBonded(toNimBLEAddress(channelAddresses_[i]))) {
      channelAddresses_[i] = {};
      saveChannel_(i);
    }
  }
  pairingMode_ = toNimBLEAddress(channelAddresses_[currentChannel_]).isNull();
}

void BleTransport::saveChannel_(uint8_t channel) {
  char key[6];
  snprintf(key, sizeof(key), "ch%u", channel);
  bondPrefs_.begin("navio_ble", false);
  bondPrefs_.putBytes(key, &channelAddresses_[channel], sizeof(BleBondAddress));
  bondPrefs_.end();
}

void BleTransport::saveCurrentChannel_() {
  bondPrefs_.begin("navio_ble", false);
  bondPrefs_.putUChar("cur", currentChannel_);
  bondPrefs_.end();
}

bool BleTransport::wasBondedAtPairingStart_(const BleBondAddress& address) const {
  for (uint8_t i = 0; i < pairingBondCount_; ++i) {
    if (sameAddress(pairingBonds_[i], address)) return true;
  }
  return false;
}

uint8_t BleTransport::bondCount() {
  return static_cast<uint8_t>(min(NimBLEDevice::getNumBonds(), static_cast<int>(BLE_BOND_MAX)));
}

bool BleTransport::readBond(uint8_t index, BleBondInfo& out) {
  if (index >= bondCount()) return false;
  NimBLEAddress address = NimBLEDevice::getBondedAddress(index);
  if (address.isNull()) return false;
  out = {};
  out.address = fromNimBLEAddress(address);
  for (uint8_t channel = 0; channel < BLE_BOND_MAX; ++channel) {
    if (sameAddress(channelAddresses_[channel], out.address)) {
      out.channel = channel + 1;
      break;
    }
  }
  out.lastUsedSeq = bondUsedSeq_(out.address);
  out.connected = connected_ && sameAddress(peerAddress_, out.address);
  return true;
}

uint32_t BleTransport::bondUsedSeq_(const BleBondAddress& address) {
  char key[16];
  bondMetadataKey(address, key);
  bondPrefs_.begin("navio_ble", true);
  uint32_t seq = bondPrefs_.getUInt(key, 0);
  bondPrefs_.end();
  return seq;
}

void BleTransport::markBondUsed_() {
  if (sameAddress(peerAddress_, lastUsedPeer_)) return;
  uint32_t next = lastUsedSeq_ + 1;
  if (next == 0) next = 1;
  char key[16];
  bondMetadataKey(peerAddress_, key);
  bondPrefs_.begin("navio_ble", false);
  bool ok = bondPrefs_.putUInt("seq", next) > 0 &&
            bondPrefs_.putUInt(key, next) > 0 &&
            bondPrefs_.putBytes("last", &peerAddress_, sizeof(BleBondAddress)) == sizeof(BleBondAddress);
  bondPrefs_.end();
  if (!ok) {
    Serial.println("[Navio] BLE bond metadata write failed");
    return;
  }
  lastUsedSeq_ = next;
  lastUsedPeer_ = peerAddress_;
}

bool BleTransport::deleteBond(const BleBondAddress& address) {
  NimBLEAddress nimAddress = toNimBLEAddress(address);
  if (!NimBLEDevice::isBonded(nimAddress)) return false;
  if (connected_ && sameAddress(peerAddress_, address)) {
    releaseAll();
    server->disconnect(connHandle_);
  }
  if (!NimBLEDevice::deleteBond(nimAddress)) return false;
  for (uint8_t channel = 0; channel < BLE_BOND_MAX; ++channel) {
    if (sameAddress(channelAddresses_[channel], address)) {
      channelAddresses_[channel] = {};
      saveChannel_(channel);
      if (channel == currentChannel_) pairingMode_ = true;
    }
  }
  for (uint8_t i = 0; i < pairingBondCount_; ++i) {
    if (!sameAddress(pairingBonds_[i], address)) continue;
    for (uint8_t j = i + 1; j < pairingBondCount_; ++j) pairingBonds_[j - 1] = pairingBonds_[j];
    pairingBonds_[--pairingBondCount_] = {};
    break;
  }

  char key[16];
  bondMetadataKey(address, key);
  bondPrefs_.begin("navio_ble", false);
  bondPrefs_.remove(key);
  if (sameAddress(lastUsedPeer_, address)) bondPrefs_.remove("last");
  bondPrefs_.end();
  if (sameAddress(lastUsedPeer_, address)) lastUsedPeer_ = {};
  restartAdvertising_();
  return true;
}

bool BleTransport::clearBonds() {
  while (NimBLEDevice::getNumBonds() > 0) {
    BleBondAddress address = fromNimBLEAddress(NimBLEDevice::getBondedAddress(0));
    if (!deleteBond(address)) return false;
  }
  bondPrefs_.begin("navio_ble", false);
  bool ok = bondPrefs_.clear();
  bondPrefs_.end();
  if (ok) {
    lastUsedPeer_ = {};
    lastUsedSeq_ = 0;
    pairingBondCount_ = 0;
    pairingMode_ = true;
    restartAdvertising_();
  }
  return ok;
}

void BleTransport::pauseAdvertising() {
  advertisingWanted_ = false;
  updateAdvertising_();
}

void BleTransport::resumeAdvertising() {
  advertisingWanted_ = true;
  updateAdvertising_();
}

bool BleTransport::reportReady_(uint8_t reportId) const {
  return connected_ && reportId >= 1 && reportId <= 3 &&
         (subscriptions_ & (1U << (reportId - 1)));
}

void BleTransport::updateBattery(uint8_t pct) {
  // notify=true：Windows 等主机不主动轮询 BAS，静默写入永远到不了 UI
  if (hid) hid->setBatteryLevel(pct, true);
}

// —— 报告发送 ——//

// 键盘报告为纯 8 字节（mods+reserved+6键），不带 Report ID 前缀
// （Report Reference descriptor 已标明报告归属；对照 HijelHID 验证实现）
void BleTransport::sendKeyboardReport_() {
  if (!chrKeyboard || !reportReady_(1)) {
    lastNotifyOk_ = false;
    return;
  }
  // 预热：连接后首帧 notify 会被主机握手期丢弃，先发空报告垫场
  if (!primed_) {
    uint8_t empty[8] = {};
    chrKeyboard->setValue(empty, 8);
    if (!chrKeyboard->notify()) {
      lastNotifyOk_ = false;
      return;
    }
    primed_ = true;
    delay(50);
  }
  uint8_t report[8] = {state_.mods(), 0, 0, 0, 0, 0, 0, 0};
  memcpy(report + 2, state_.keys(), 6);
  chrKeyboard->setValue(report, sizeof(report));
  lastNotifyOk_ = chrKeyboard->notify();
}

void BleTransport::pressChord(uint8_t modMask, uint16_t usage) {
  if (!reportReady_(1)) {
    lastNotifyOk_ = false;
    return;
  }
  state_.pressChord(modMask, usage);
  sendKeyboardReport_();
}

void BleTransport::releaseChord(uint8_t modMask, uint16_t usage) {
  state_.releaseChord(modMask, usage);
  sendKeyboardReport_();
}

void BleTransport::releaseAll() {
  state_.releaseAll();
  sendKeyboardReport_();
  sendConsumerReport_();
}

void BleTransport::consumerPress(uint16_t usage) {
  if (!reportReady_(2)) return;
  state_.pressConsumer(usage);
  sendConsumerReport_();
}

void BleTransport::consumerRelease(uint16_t usage) {
  state_.releaseConsumer(usage);
  sendConsumerReport_();
}

void BleTransport::sendConsumerReport_() {
  if (!chrConsumer || !reportReady_(2)) return;
  uint16_t usage = state_.consumerUsage();
  uint8_t report[2] = {static_cast<uint8_t>(usage & 0xFF),
                       static_cast<uint8_t>(usage >> 8)};
  chrConsumer->setValue(report, 2);
  chrConsumer->notify();
}

void BleTransport::mouseWheel(int8_t dy) {
  if (!chrMouse || !reportReady_(3)) return;
  uint8_t report[4] = {0, 0, 0, static_cast<uint8_t>(dy)};  // 按钮, X, Y, 滚轮
  chrMouse->setValue(report, 4);
  chrMouse->notify();
}

}  // namespace navio
