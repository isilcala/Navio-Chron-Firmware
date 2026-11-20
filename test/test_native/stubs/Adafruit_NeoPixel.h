#pragma once

#include <Arduino.h>

#include <vector>

constexpr uint16_t NEO_GRB = 0;
constexpr uint16_t NEO_KHZ800 = 0;

extern std::vector<uint32_t> fakeNeoPixelPixels;
extern std::vector<std::vector<uint32_t>> fakeNeoPixelFrames;

class Adafruit_NeoPixel {
 public:
  Adafruit_NeoPixel(uint16_t count, uint8_t pin, uint16_t type) {
    (void)pin;
    (void)type;
    fakeNeoPixelPixels.assign(count, 0);
  }

  void begin() {}
  void show() { fakeNeoPixelFrames.push_back(fakeNeoPixelPixels); }

  void setPixelColor(uint16_t index, uint32_t color) {
    if (index < fakeNeoPixelPixels.size()) fakeNeoPixelPixels[index] = color;
  }

  void setPixelColor(uint16_t index, uint8_t r, uint8_t g, uint8_t b) {
    setPixelColor(index, Color(r, g, b));
  }

  uint32_t getPixelColor(uint16_t index) const {
    return index < fakeNeoPixelPixels.size() ? fakeNeoPixelPixels[index] : 0;
  }

  static uint32_t Color(uint8_t r, uint8_t g, uint8_t b) {
    return (static_cast<uint32_t>(r) << 16) |
           (static_cast<uint32_t>(g) << 8) | b;
  }
};
