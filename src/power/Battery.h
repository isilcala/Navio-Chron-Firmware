#pragma once
// 电池电量：GPIO3 分压采样（实测比 1:2.195，见 Config.h 标定注释）。
// 模块内置充电但无充电状态引出，且插线时分压节点被抬到 ~5V，仅电池模式读数有效
#include <Arduino.h>

#include "Config.h"

namespace navio {

class Battery {
 public:
  void begin();  // 引脚配置 + 初次测量
  void tick();   // 到周期重新测量
  void setUsbPowered(bool on) { usbPowered_ = on; }  // 插线=充电中，冻结电量读数
  uint8_t percent() const { return pct_; }
  bool low() const { return pct_ <= BATTERY_LOW_PERCENT; }

 private:
  uint8_t pct_ = 100;
  bool usbPowered_ = false;
  uint32_t lastMs_ = 0;
};

}  // namespace navio
