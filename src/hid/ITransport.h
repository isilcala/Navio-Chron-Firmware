#pragma once
// HID 传输层统一接口：USB / BLE 各自实现，运行时只激活一个
#include <Arduino.h>

namespace navio {

class ITransport {
 public:
  virtual ~ITransport() {}
  virtual void begin() = 0;
  virtual bool isConnected() = 0;
  virtual const char* name() = 0;
  // 修饰键+键码和弦：usage=0 表示仅修饰键；键码均为 HID Usage ID
  virtual void pressChord(uint8_t modMask, uint16_t usage) = 0;
  virtual void releaseChord(uint8_t modMask, uint16_t usage) = 0;
  virtual void releaseAll() = 0;
  virtual void consumerPress(uint16_t usage) = 0;
  virtual void consumerRelease(uint16_t usage) = 0;
  virtual void mouseWheel(int8_t dy) = 0;
};

}  // namespace navio
