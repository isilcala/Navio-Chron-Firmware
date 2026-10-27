#pragma once
// S3 原生 USB (Adafruit_TinyUSB)：键盘、消费控制、鼠标各自独立 HID 接口
#include "hid/HidInputState.h"
#include "hid/ITransport.h"

namespace navio {

class UsbTransport : public ITransport {
 public:
  void begin() override;
  bool isConnected() override;
  const char* name() override { return "USB"; }
  void pressChord(uint8_t modMask, uint16_t usage) override;
  void releaseChord(uint8_t modMask, uint16_t usage) override;
  void releaseAll() override;
  void consumerPress(uint16_t usage) override;
  void consumerRelease(uint16_t usage) override;
  void mouseWheel(int8_t dy) override;

 private:
  HidInputState state_;
  void sendKeyboardReport_();
  void sendConsumerReport_();
};

}  // namespace navio
