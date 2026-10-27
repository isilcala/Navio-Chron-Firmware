#pragma once
// BLE HID 传输（NimBLE-Arduino 2.5.x / core 3.x）：
// 键盘(报告1) + 消费控制(报告2) + 鼠标(报告3)。USB 挂载检测由 UsbTransport 负责，
// main 据此切换 transport（D3 自动选模式）
#include "hid/HidInputState.h"
#include "hid/ITransport.h"

namespace navio {

class BleTransport : public ITransport {
 public:
  void begin() override;
  bool isConnected() override { return connected_; }
  const char* name() override { return "BLE"; }

  void pressChord(uint8_t modMask, uint16_t usage) override;
  void releaseChord(uint8_t modMask, uint16_t usage) override;
  void releaseAll() override;
  void consumerPress(uint16_t usage) override;
  void consumerRelease(uint16_t usage) override;
  void mouseWheel(int8_t dy) override;

  // 配对模式：清绑定 + 可发现广播（侧键长按 5s 触发）
  void enterPairing();
  // USB 优先时段停广播省电/防误连；恢复时自动重连已配对主机
  void pauseAdvertising();
  void resumeAdvertising();
  bool isAdvertising() const { return advertising_; }

  // HID 电池服务上报（main 周期调用）
  void updateBattery(uint8_t pct);

  // 最近一次键盘报告 notify 是否成功
  bool lastSendOk() const { return lastNotifyOk_; }

  // server 回调转发（内部使用）
  void onConnect_(uint16_t connHandle);
  void onDisconnect_();

 private:
  HidInputState state_;
  void sendKeyboardReport_();
  void sendConsumerReport_();
  bool lastNotifyOk_ = false;
  bool primed_ = false;  // 连接后首帧报告需预热（主机握手期会丢弃）

  volatile bool connected_ = false;
  bool advertising_ = false;
  uint16_t connHandle_ = 0;
};

}  // namespace navio
