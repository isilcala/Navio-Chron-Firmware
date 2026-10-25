#include "input/MatrixScanner.h"

#include "Config.h"
#include "Pins.h"

namespace navio {

const MatrixScanner::Placement MatrixScanner::kPlacements[BTN_COUNT] = {
    {0, 1, Btn::K1},   {0, 2, Btn::K2},   {0, 3, Btn::K3},
    {1, 3, Btn::K4},   {1, 4, Btn::K5},   {2, 4, Btn::K6},
    {2, 3, Btn::K7},   {2, 2, Btn::K8},   {2, 1, Btn::K9},
    {3, 1, Btn::K10},  {3, 2, Btn::K11},  {3, 3, Btn::K12},
    {1, 2, Btn::EncCenterPress},
    {3, 0, Btn::EncLargePress},
    {0, 0, Btn::SideKey},
    {1, 0, Btn::Tact},
};

void MatrixScanner::begin() {
  for (uint8_t r : PIN_ROW) {
    pinMode(r, OUTPUT);
    digitalWrite(r, HIGH);  // 行无效电平
  }
  for (uint8_t c : PIN_COL) pinMode(c, INPUT_PULLUP);
}

void MatrixScanner::poll() {
  // 逐行拉低采样；只有占位表里的格点需要读取
  for (int r = 0; r < 4; ++r) {
    digitalWrite(PIN_ROW[r], LOW);
    delayMicroseconds(ROW_SETTLE_US);
    for (size_t i = 0; i < BTN_COUNT; ++i) {
      const auto& p = kPlacements[i];
      if (p.row != r) continue;
      bool down = digitalRead(PIN_COL[p.col]) == LOW;
      if (down != lastSample_[i]) {
        lastSample_[i] = down;
        debounce_[i] = 0;
      } else if (++debounce_[i] >= KEY_DEBOUNCE_TICKS && state_[i] != down) {
        state_[i] = down;
        push_({p.id, down});
      }
    }
    digitalWrite(PIN_ROW[r], HIGH);
    delayMicroseconds(ROW_SETTLE_US);
  }
}

bool MatrixScanner::next(BtnEvent& out) {
  if (head_ == tail_) return false;
  out = queue_[head_];
  head_ = (head_ + 1) % 16;
  return true;
}

void MatrixScanner::push_(const BtnEvent& e) {
  uint8_t nextTail = (tail_ + 1) % 16;
  if (nextTail == head_) return;  // 队满丢弃（正常输入速率不可能发生）
  queue_[tail_] = e;
  tail_ = nextTail;
}

}  // namespace navio
