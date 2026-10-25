#pragma once
// 电池电量：GPIO3 ÷2 分压采样。模块内置充电但无充电状态引出，只做电压估算
#include <Arduino.h>

#include "Config.h"

namespace navio {

class Battery {
 public:
  void begin();  // 引脚配置 + 初次测量
  void tick();   // 到周期重新测量
  uint8_t percent() const { return pct_; }
  bool low() const { return pct_ <= BATTERY_LOW_PERCENT; }

 private:
  uint8_t pct_ = 100;
  uint32_t lastMs_ = 0;
};

}  // namespace navio
