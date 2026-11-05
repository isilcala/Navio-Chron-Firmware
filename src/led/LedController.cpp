#include "led/LedController.h"

#include "Config.h"
#include "Pins.h"

namespace navio {

namespace {

uint8_t scale(uint8_t c) {
  return (uint16_t)c * LED_BRIGHTNESS / 255;
}

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
    fadeStartedAt_[key] = 0;
    setKeyColor_(key, rgbMode_ == Follow ? 255 : rgbMode_ == Breath ? 32 : 0);
  }
  dirty_ = true;
  flush();
}

void LedController::setKeyColor_(uint8_t key, uint8_t level) {
  if (key >= KEY_COUNT) return;
  const uint8_t r = (uint16_t)scale(accent_[0]) * level / 255;
  const uint8_t g = (uint16_t)scale(accent_[1]) * level / 255;
  const uint8_t b = (uint16_t)scale(accent_[2]) * level / 255;
  const uint32_t color = chain_.Color(r, g, b);
  if (chain_.getPixelColor(LED_KEY_FIRST + key) == color) return;
  chain_.setPixelColor(LED_KEY_FIRST + key, color);
  dirty_ = true;
}

void LedController::setKeyPressed(uint8_t key, bool pressed) {
  if (rgbMode_ != Reactive || key >= KEY_COUNT) return;
  if (pressed) {
    keyHeld_[key] = true;
    fadeStartedAt_[key] = 0;
    setKeyColor_(key, 255);
    return;
  }
  if (!keyHeld_[key]) return;
  keyHeld_[key] = false;
  fadeStartedAt_[key] = millis();
}

void LedController::releaseKeys() {
  if (rgbMode_ != Reactive) return;
  const uint32_t now = millis();
  for (uint8_t key = 0; key < KEY_COUNT; ++key) {
    if (!keyHeld_[key]) continue;
    keyHeld_[key] = false;
    fadeStartedAt_[key] = now;
  }
}

void LedController::updateEffects_(uint32_t now) {
  if (rgbMode_ == Reactive) {
    for (uint8_t key = 0; key < KEY_COUNT; ++key) {
      if (keyHeld_[key] || !fadeStartedAt_[key]) continue;
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
