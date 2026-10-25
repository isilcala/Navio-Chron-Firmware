#pragma once
// 极简 WS2812 链驱动，基于核心 RMT 新 API（rmtInit/rmtWriteBlocking）。
// 不用 Adafruit_NeoPixel：其 IDF4 旧驱动路径（rmt_driver_install/rmt_write_sample）
// 在本项目的 S3 + Arduino core 2.0.17 组合上会因 TX 完成中断永不触发而死锁
// （2026-10-25 实测：卡死在 leds.begin() 的首个 show()，见 docs/DECISIONS.md D8）。
#include <Arduino.h>

#include "esp32-hal-rmt.h"

namespace navio {

class Ws2812 {
 public:
  Ws2812(uint8_t pin, int count) : pin_(pin), count_(count) {}

  void begin() {
    pixels_ = (uint8_t*)calloc(count_, 3);  // 每像素 GRB 三字节
    symbols_ = (rmt_data_t*)malloc((size_t)count_ * 24 * sizeof(rmt_data_t));
    rmt_ = rmtInit(pin_, RMT_TX_MODE, RMT_MEM_64);
    if (rmt_) rmtSetTick(rmt_, 50.0f);  // 50ns/tick
    show();
  }

  void setPixelColor(int i, uint8_t r, uint8_t g, uint8_t b) {
    if (i < 0 || i >= count_) return;
    pixels_[i * 3 + 0] = g;  // WS2812B 字节序：G R B
    pixels_[i * 3 + 1] = r;
    pixels_[i * 3 + 2] = b;
  }

  void clear() {
    if (pixels_) memset(pixels_, 0, (size_t)count_ * 3);
  }

  void show() {
    if (!rmt_ || !pixels_ || !symbols_) return;
    int n = 0;
    for (int i = 0; i < count_ * 3; ++i) {
      for (int bit = 7; bit >= 0; --bit, ++n) {
        bool one = pixels_[i] & (1 << bit);
        symbols_[n].val = 0;
        symbols_[n].duration0 = one ? 16 : 8;  // T1H 800ns / T0H 400ns
        symbols_[n].level0 = 1;
        symbols_[n].duration1 = one ? 9 : 17;  // T1L 450ns / T0L 850ns
        symbols_[n].level1 = 0;
      }
    }
    rmtWriteBlocking(rmt_, symbols_, (size_t)count_ * 24);
    // >50µs 低电平复位码由本帧结束到下次 show 之间的空闲时间自然满足
  }

 private:
  uint8_t pin_;
  int count_;
  uint8_t* pixels_ = nullptr;
  rmt_data_t* symbols_ = nullptr;
  rmt_obj_t* rmt_ = nullptr;
};

}  // namespace navio
