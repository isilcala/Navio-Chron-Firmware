#include "led/LedController.h"

#include "Config.h"
#include "Pins.h"

namespace navio {

namespace {

uint8_t scale(uint8_t c) {
  return (uint16_t)c * LED_BRIGHTNESS / 255;
}

void hsvToRgb(uint8_t hue, uint8_t out[3]) {
  const uint8_t region = hue / 43;
  const uint8_t offset = (hue - region * 43) * 6;
  switch (region) {
    case 0: out[0] = 255; out[1] = offset; out[2] = 0; break;
    case 1: out[0] = 255 - offset; out[1] = 255; out[2] = 0; break;
    case 2: out[0] = 0; out[1] = 255; out[2] = offset; break;
    case 3: out[0] = 0; out[1] = 255 - offset; out[2] = 255; break;
    case 4: out[0] = offset; out[1] = 0; out[2] = 255; break;
    default: out[0] = 255; out[1] = 0; out[2] = 255 - offset; break;
  }
}

constexpr uint8_t RAINBOW_KEY_ORDER[12] = {
  0, 1, 2, 3, 4, 5, 6, 11, 10, 9, 7, 8,
};

}  // namespace

void LedController::begin() {
  chain_.begin();
}

void LedController::showPreset(const uint8_t accent[3], uint8_t rgbMode) {
  for (uint8_t i = 0; i < 3; ++i) accent_[i] = accent[i];
  rgbMode_ = rgbMode;
  effectStartedAt_ = millis();
  chain_.setPixelColor(0, scale(accent_[0]), scale(accent_[1]), scale(accent_[2]));
  for (uint8_t key = 0; key < KEY_COUNT; ++key) {
    keyHeld_[key] = false;
    confirmAt_[key] = 0;
    fadeStartedAt_[key] = 0;
    setKeyColor_(key, rgbMode_ == Follow ? 255 : rgbMode_ == Breath ? 32 : 0);
  }
  dirty_ = true;
  flush();
}

void LedController::setKeyColor_(uint8_t key, uint8_t level) {
  const uint8_t rgb[3] = {
    static_cast<uint8_t>(accent_[0] * level / 255),
    static_cast<uint8_t>(accent_[1] * level / 255),
    static_cast<uint8_t>(accent_[2] * level / 255),
  };
  setKeyRgb_(key, rgb);
}

void LedController::setKeyRgb_(uint8_t key, const uint8_t rgb[3]) {
  if (key >= KEY_COUNT) return;
  const uint32_t color = chain_.Color(scale(rgb[0]), scale(rgb[1]), scale(rgb[2]));
  if (chain_.getPixelColor(LED_KEY_FIRST + key) == color) return;
  chain_.setPixelColor(LED_KEY_FIRST + key, color);
  dirty_ = true;
}

void LedController::setKeyPressed(uint8_t key, bool pressed) {
  if (rgbMode_ != Reactive || key >= KEY_COUNT) return;
  if (pressed) {
    keyHeld_[key] = true;
    confirmAt_[key] = millis() + LED_REACTIVE_CONFIRM_MS;
    fadeStartedAt_[key] = 0;
    setKeyColor_(key, 255);
    return;
  }
  if (!keyHeld_[key]) return;
  keyHeld_[key] = false;
  confirmAt_[key] = 0;
  fadeStartedAt_[key] = millis();
}

void LedController::releaseKeys() {
  if (rgbMode_ != Reactive) return;
  const uint32_t now = millis();
  for (uint8_t key = 0; key < KEY_COUNT; ++key) {
    confirmAt_[key] = 0;
    if (!keyHeld_[key]) continue;
    keyHeld_[key] = false;
    fadeStartedAt_[key] = now;
  }
}

void LedController::updateEffects_(uint32_t now) {
  if (rgbMode_ == Reactive) {
    for (uint8_t key = 0; key < KEY_COUNT; ++key) {
      if (keyHeld_[key]) {
        if (confirmAt_[key] && static_cast<int32_t>(now - confirmAt_[key]) >= 0) {
          confirmAt_[key] = 0;
          dirty_ = true;
        }
        continue;
      }
      if (!fadeStartedAt_[key]) continue;
      const uint32_t elapsed = now - fadeStartedAt_[key];
      const uint8_t level = elapsed >= LED_REACTIVE_FADE_MS
        ? 0 : 255 - (uint32_t)elapsed * 255 / LED_REACTIVE_FADE_MS;
      setKeyColor_(key, level);
      if (elapsed >= LED_REACTIVE_FADE_MS) fadeStartedAt_[key] = 0;
    }
  } else if (rgbMode_ == Breath) {
    const uint32_t cycle = LED_BREATH_PERIOD_MS + LED_BREATH_PEAK_HOLD_MS + LED_BREATH_DARK_HOLD_MS;
    const uint32_t phase = (now - effectStartedAt_) % cycle;
    const uint32_t half = LED_BREATH_PERIOD_MS / 2;
    uint8_t level = 32;
    if (phase < LED_BREATH_PERIOD_MS + LED_BREATH_PEAK_HOLD_MS) {
      const uint32_t linear = phase < half ? phase * 255 / half : phase < half + LED_BREATH_PEAK_HOLD_MS
        ? 255 : (LED_BREATH_PERIOD_MS + LED_BREATH_PEAK_HOLD_MS - phase) * 255 / half;
      const uint32_t eased = linear * linear * (3 * 255 - 2 * linear) / (255 * 255);
      level = 32 + eased * 223 / 255;
    }
    for (uint8_t key = 0; key < KEY_COUNT; ++key) setKeyColor_(key, level);
  } else if (rgbMode_ == ColorCycle || rgbMode_ == RainbowFlow) {
    const uint32_t phase = (now - effectStartedAt_) % LED_COLOR_CYCLE_PERIOD_MS;
    const uint8_t baseHue = phase * 256 / LED_COLOR_CYCLE_PERIOD_MS;
    uint8_t rgb[3];
    if (rgbMode_ == ColorCycle) {
      hsvToRgb(baseHue, rgb);
      for (uint8_t key = 0; key < KEY_COUNT; ++key) setKeyRgb_(key, rgb);
    } else {
      for (uint8_t position = 0; position < KEY_COUNT; ++position) {
        const uint8_t hue = static_cast<uint8_t>(baseHue - position * 256 / KEY_COUNT);
        hsvToRgb(hue, rgb);
        setKeyRgb_(RAINBOW_KEY_ORDER[position], rgb);
      }
    }
  }
}

void LedController::flush() {
  if (!dirty_) return;
  chain_.show();
  dirty_ = false;
  lastShowMs_ = millis();
}

void LedController::setModeColor(uint8_t r, uint8_t g, uint8_t b) {
  uint32_t color = chain_.Color(scale(r), scale(g), scale(b));
  if (chain_.getPixelColor(1) == color) return;
  chain_.setPixelColor(1, color);
  dirty_ = true;
}

void LedController::setBatteryLow(bool low) {
  if (low == lowBattery_) return;
  lowBattery_ = low;
  if (!low) {
    chain_.setPixelColor(2, 0, 0, 0);
    dirty_ = true;
  }
}

void LedController::tick() {
  uint32_t now = millis();
  if (now - lastBlinkMs_ >= 1000) {
    lastBlinkMs_ = now;
    if (lowBattery_) {
      blinkOn_ = !blinkOn_;
      chain_.setPixelColor(2, blinkOn_ ? scale(255) : 0, 0, 0);
      dirty_ = true;
    }
  }
  updateEffects_(now);
  if (!dirty_ || now - lastShowMs_ < LED_TICK_INTERVAL_MS) return;
  chain_.show();
  dirty_ = false;
  lastShowMs_ = now;
}

}  // namespace navio
