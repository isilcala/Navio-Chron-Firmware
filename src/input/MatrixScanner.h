#pragma once
// 4x5 矩阵轮询扫描，带消抖；只遍历 16 个实际占位
#include "input/InputEvents.h"

namespace navio {

class MatrixScanner {
 public:
  void begin();
  // 每个轮询周期调用；事件进入内部环形队列，用 next() 取出
  void poll();
  bool next(BtnEvent& out);
  // 直接读取某个矩阵位的当前电平（不经消抖），用于启动早期/长按检测等特殊场景
  bool rawKeyDown(uint8_t row, uint8_t col);

 private:
  struct Placement {
    uint8_t row, col;
    Btn id;
  };
  // 矩阵占位表（行 0-3 = ROW1-4，列 0-4 = COL1-5），与 InputEvents.h 注释一致
  static const Placement kPlacements[BTN_COUNT];

  bool state_[BTN_COUNT] = {};
  uint8_t debounce_[BTN_COUNT] = {};  // 采样不一致计数
  bool lastSample_[BTN_COUNT] = {};

  BtnEvent queue_[16];
  uint8_t head_ = 0, tail_ = 0;
  void push_(const BtnEvent& e);
};

}  // namespace navio
