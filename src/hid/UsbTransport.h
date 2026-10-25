#pragma once
// S3 原生 USB (TinyUSB)：键盘 + 消费控制 + 鼠标 复合设备
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
  void consumerRelease() override;
  void mouseWheel(int8_t dy) override;
};

}  // namespace navio
