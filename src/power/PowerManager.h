#pragma once
// 无线空闲计时与深睡唤醒；USB/诊断环境的禁睡策略由 main 统一裁决。
#include <Arduino.h>

namespace navio {

class PowerManager {
 public:
  void begin();
  void notifyActivity();
  bool lightingIdle() const;
  bool deepSleepDue() const;
  static bool wokeFromDeepSleep();
  static void restoreAfterWake();
  bool prepareDeepSleep();
  void enterDeepSleep();

 private:
  uint32_t lastActivityMs_ = 0;
};

}  // namespace navio
