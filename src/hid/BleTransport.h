#pragma once
// BLE HID 传输（NimBLE-Arduino 2.5.x / core 3.x）：
// 键盘(报告1) + 消费控制(报告2) + 鼠标(报告3)。USB 挂载检测由 UsbTransport 负责，
// main 据此切换 transport（D3 自动选模式）
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <Preferences.h>

#include "hid/BleBondManager.h"
#include "hid/HidInputState.h"
#include "hid/ITransport.h"

class NimBLEConnInfo;

namespace navio {

class BleTransport : public ITransport, public IBleBondManager {
 public:
  void begin() override;
  void poll();
  bool isConnected() override { return connected_; }
  bool hasReportSubscriptions() const { return subscriptions_ != 0; }
  const char* name() override { return "BLE"; }

  void pressChord(uint8_t modMask, uint16_t usage) override;
  void releaseChord(uint8_t modMask, uint16_t usage) override;
  void releaseAll() override;
  void consumerPress(uint16_t usage) override;
  void consumerRelease(uint16_t usage) override;
  void mouseWheel(int8_t dy) override;

  bool enterPairing();
  void selectChannel(uint8_t channel);
  bool isPairing() const { return pairingMode_; }
  uint8_t currentChannel() const { return currentChannel_; }
  uint8_t bondCount() override;
  bool readBond(uint8_t index, BleBondInfo& out) override;
  bool deleteBond(const BleBondAddress& address) override;
  bool clearBonds() override;

  // USB 优先时段停广播省电/防误连；恢复时自动重连已配对主机
  void pauseAdvertising();
  void resumeAdvertising();
  void prepareForDeepSleep();
  bool isAdvertising() const { return advertising_; }

  // HID 电池服务上报（main 周期调用）
  void updateBattery(uint8_t pct);

  // 最近一次键盘报告 notify 是否成功
  bool lastSendOk() const { return lastNotifyOk_; }

  // NimBLE 回调只投递事件，由主循环 poll() 更新状态
  void onConnect_(const NimBLEConnInfo& connInfo);
  void onPeerSecurity_(const NimBLEConnInfo& connInfo);
  void onDisconnect_(uint16_t connHandle, int reason);
  void onSubscribe_(const NimBLEConnInfo& connInfo, uint8_t reportId, uint16_t subValue);

 private:
  enum class EventType : uint8_t { Connect, Security, Disconnect, Subscribe };
  struct Event {
    EventType type;
    uint16_t connHandle;
    uint8_t reportId;
    uint16_t subValue;
    BleBondAddress peerAddress;
    BleBondAddress otaAddress;
  };

  HidInputState state_;
  QueueHandle_t eventQueue_ = nullptr;
  std::atomic<uint32_t> droppedEvents_{0};
  void postEvent_(const Event& event);
  void updateAdvertising_();
  void restartAdvertising_();
  void configureConnectionFilter_(bool enable, const BleBondAddress& address);
  bool reportReady_(uint8_t reportId) const;
  void sendKeyboardReport_();
  void sendConsumerReport_();
  uint32_t bondUsedSeq_(const BleBondAddress& address);
  void markBondUsed_();
  bool wasBondedAtPairingStart_(const BleBondAddress& address) const;
  bool isChannelBonded_(const BleBondAddress& address) const;
  bool isSelectedHost_(const BleBondAddress& address) const;
  void loadChannels_();
  void saveChannel_(uint8_t channel);
  void saveCurrentChannel_();
  bool lastNotifyOk_ = false;
  bool primed_ = false;  // 连接后首帧报告需预热（主机握手期会丢弃）

  bool connected_ = false;
  uint8_t subscriptions_ = 0;
  bool advertisingWanted_ = true;
  bool advertising_ = false;
  bool pairingMode_ = false;
  uint16_t connHandle_ = 0;
  BleBondAddress peerAddress_{};
  BleBondAddress lastUsedPeer_{};
  BleBondAddress pairingBonds_[BLE_BOND_MAX] = {};
  uint8_t pairingBondCount_ = 0;
  BleBondAddress channelAddresses_[BLE_BOND_MAX] = {};
  uint8_t currentChannel_ = 0;
  Preferences bondPrefs_;
  uint32_t lastUsedSeq_ = 0;
};

}  // namespace navio
