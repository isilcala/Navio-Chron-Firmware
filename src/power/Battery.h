#pragma once
// 电池电量：GPIO3 分压采样（实测比 1:2.195，见 Config.h 标定注释）。
// 充电中节点被充电电路抬高，读数偏高甚至 100%——接受，简单优先（D25 修订）
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
