#pragma once
// 编码器轮询式四倍频解码（无中断，与主循环 1ms 轮询配合）
#include "input/InputEvents.h"

namespace navio {

class Encoders {
 public:
  void begin();
  void poll();
  bool next(EncoderEvent& out);
  uint16_t takeDroppedEvents();

 private:
  struct Channel {
    uint8_t pinA, pinB;
    uint8_t last;   // 上次采样的 2bit AB
    int32_t count;  // 四倍频原始计数
  };
  static Channel kChannels[ENC_COUNT];

  int32_t emitted_[ENC_COUNT] = {};  // 已触发的计数刻度

  EncoderEvent queue_[16];
  uint8_t head_ = 0, tail_ = 0;
  uint16_t droppedEvents_ = 0;
  void push_(const EncoderEvent& e);
};

}  // namespace navio
