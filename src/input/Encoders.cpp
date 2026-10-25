#include "input/Encoders.h"

#include "Config.h"
#include "Pins.h"

namespace navio {

Encoders::Channel Encoders::kChannels[ENC_COUNT] = {
    {PIN_ENC_CENTER_A, PIN_ENC_CENTER_B, 0, 0},
    {PIN_ENC_LARGE_A, PIN_ENC_LARGE_B, 0, 0},
    {PIN_ENC_WHEEL_A, PIN_ENC_WHEEL_B, 0, 0},
};

// 2bit 格雷码 → 计数变化表。无效跳变（双跳变）视为抖动，计 0。
// 行=上次 AB，列=本次 AB（顺序 00,01,11,10）
static const int8_t kQuadTable[4][4] = {
    {0, -1, 1, 0},
    {1, 0, 0, -1},
    {-1, 0, 0, 1},
    {0, 1, -1, 0},
};

void Encoders::begin() {
  for (auto& ch : kChannels) {
    pinMode(ch.pinA, INPUT);  // 板上有 10k 上拉
    pinMode(ch.pinB, INPUT);
    ch.last = (digitalRead(ch.pinA) << 1) | digitalRead(ch.pinB);
  }
}

void Encoders::poll() {
  // 矩阵+编码器整轮扫描 <100µs，三个通道每个 tick 全量轮询，避免快速旋转丢步
  for (uint8_t idx = 0; idx < ENC_COUNT; ++idx) {
    Channel& ch = kChannels[idx];
    uint8_t now = (digitalRead(ch.pinA) << 1) | digitalRead(ch.pinB);
    if (now == ch.last) continue;
    ch.count += kQuadTable[ch.last][now];
    ch.last = now;

    int divisor = ENC_DETENT_DIVISOR[idx] > 0 ? ENC_DETENT_DIVISOR[idx] : 1;
    int32_t scaled = ch.count / divisor;
    if (scaled == emitted_[idx]) continue;
    int8_t dir = scaled > emitted_[idx] ? 1 : -1;
    emitted_[idx] = scaled;
    push_({static_cast<Enc>(idx), dir});
  }
}

bool Encoders::next(EncoderEvent& out) {
  if (head_ == tail_) return false;
  out = queue_[head_];
  head_ = (head_ + 1) % 16;
  return true;
}

void Encoders::push_(const EncoderEvent& e) {
  uint8_t nextTail = (tail_ + 1) % 16;
  if (nextTail == head_) return;
  queue_[tail_] = e;
  tail_ = nextTail;
}

}  // namespace navio
