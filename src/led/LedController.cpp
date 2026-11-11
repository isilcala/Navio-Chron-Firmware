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

uint8_t nextRandomHue(uint8_t previous) {
  uint8_t hue = previous;
  for (uint8_t attempt = 0; attempt < 4 && hue == previous; ++attempt) hue = esp_random() & 0xFF;
  return hue == previous ? previous + 1 : hue;
}

constexpr uint8_t RAINBOW_KEY_ORDER[12] = {
  0, 1, 2, 3, 4, 5, 6, 11, 10, 9, 7, 8,
};

}  // namespace

void LedController::begin() {
  chain_.begin();
}

void LedController::showPreset(const uint8_t accent[3], uint8_t rgbMode) {
  channelFeedbackKey_ = CHANNEL_FEEDBACK_OFF;
  for (uint8_t i = 0; i < 3; ++i) accent_[i] = accent[i];
  rgbMode_ = rgbMode;
  effectStartedAt_ = millis();
  breathCycle_ = 0xFFFFFFFF;
  for (uint8_t key = 0; key < KEY_COUNT; ++key) {
    keyHeld_[key] = false;
    confirmAt_[key] = 0;
    fadeStartedAt_[key] = 0;
  }
  chain_.setPixelColor(0, scale(accent_[0]), scale(accent_[1]), scale(accent_[2]));
  if (!idle_) {
    for (uint8_t key = 0; key < KEY_COUNT; ++key) {
      setKeyColor_(key, rgbMode_ == Follow ? 255 : 0);
    }
  }
  dirty_ = true;
  flush();
}

void LedController::setIdle(bool idle) {
  if (idle == idle_) return;
  idle_ = idle;
  if (idle_) {
    for (uint8_t key = 0; key < KEY_COUNT; ++key) chain_.setPixelColor(LED_KEY_FIRST + key, 0);
    dirty_ = true;
    flush();
    return;
  }

  showPreset(accent_, rgbMode_);
  chain_.setPixelColor(1, chain_.Color(scale(modeColor_[0]), scale(modeColor_[1]), scale(modeColor_[2])));
  chain_.setPixelColor(2, lowBattery_ && blinkOn_ ? chain_.Color(scale(255), 0, 0) : 0);
  dirty_ = true;
  flush();
}

void LedController::shutdown() {
  idle_ = true;
  for (uint8_t i = 0; i < LED_COUNT; ++i) chain_.setPixelColor(i, 0);
  dirty_ = true;
  flush();
}

void LedController::showChannelFeedback(uint8_t key) {
  if (key >= KEY_COUNT) return;
  channelFeedbackKey_ = key;
  channelFeedbackStartedAt_ = millis();
  for (uint8_t i = 0; i < KEY_COUNT; ++i) chain_.setPixelColor(LED_KEY_FIRST + i, 0);
  dirty_ = true;
}

void LedController::setKeyColor_(uint8_t key, uint8_t level) {
  const uint8_t rgb[3] = {
    static_cast<uint8_t>(accent_[0] * level / 255),
    static_cast<uint8_t>(accent_[1] * level / 255),
    static_cast<uint8_t>(accent_[2] * level / 255),
  };
  setKeyRgb_(key, rgb);
}

void LedController::setKeyHueLevel_(uint8_t key, uint8_t hue, uint8_t level) {
  uint8_t rgb[3];
  hsvToRgb(hue, rgb);
  for (uint8_t channel = 0; channel < 3; ++channel) rgb[channel] = rgb[channel] * level / 255;
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
  if (idle_ || (rgbMode_ != Reactive && rgbMode_ != ReactiveRandom) || key >= KEY_COUNT) return;
  if (pressed) {
    keyHeld_[key] = true;
    confirmAt_[key] = millis() + LED_REACTIVE_CONFIRM_MS;
    fadeStartedAt_[key] = 0;
    if (rgbMode_ == ReactiveRandom) {
      keyHue_[key] = nextRandomHue(keyHue_[key]);
      setKeyHueLevel_(key, keyHue_[key], 255);
    } else {
      setKeyColor_(key, 255);
    }
    return;
  }
  if (!keyHeld_[key]) return;
  keyHeld_[key] = false;
  confirmAt_[key] = 0;
  fadeStartedAt_[key] = millis();
}

void LedController::releaseKeys() {
  if (rgbMode_ != Reactive && rgbMode_ != ReactiveRandom) return;
  const uint32_t now = millis();
  for (uint8_t key = 0; key < KEY_COUNT; ++key) {
    confirmAt_[key] = 0;
    if (!keyHeld_[key]) continue;
    keyHeld_[key] = false;
    fadeStartedAt_[key] = now;
  }
}

void LedController::updateEffects_(uint32_t now) {
  if (rgbMode_ == Reactive || rgbMode_ == ReactiveRandom) {
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
      if (rgbMode_ == ReactiveRandom) setKeyHueLevel_(key, keyHue_[key], level);
      else setKeyColor_(key, level);
      if (elapsed >= LED_REACTIVE_FADE_MS) fadeStartedAt_[key] = 0;
    }
  } else if (rgbMode_ == Breath || rgbMode_ == BreathRandom) {
    const uint32_t cycle = LED_BREATH_PERIOD_MS + LED_BREATH_PEAK_HOLD_MS + LED_BREATH_DARK_HOLD_MS;
    const uint32_t elapsed = now - effectStartedAt_;
    const uint32_t phase = elapsed % cycle;
    if (rgbMode_ == BreathRandom && elapsed / cycle != breathCycle_) {
      breathCycle_ = elapsed / cycle;
      breathHue_ = nextRandomHue(breathHue_);
    }
    const uint32_t half = LED_BREATH_PERIOD_MS / 2;
    uint8_t level = 0;
    if (phase < LED_BREATH_PERIOD_MS + LED_BREATH_PEAK_HOLD_MS) {
      const uint32_t linear = phase < half ? phase * 255 / half : phase < half + LED_BREATH_PEAK_HOLD_MS
        ? 255 : (LED_BREATH_PERIOD_MS + LED_BREATH_PEAK_HOLD_MS - phase) * 255 / half;
      const uint32_t eased = linear * linear * (3 * 255 - 2 * linear) / (255 * 255);
      level = eased;
    }
    for (uint8_t key = 0; key < KEY_COUNT; ++key) {
      if (rgbMode_ == BreathRandom) setKeyHueLevel_(key, breathHue_, level);
      else setKeyColor_(key, level);
    }
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
  } else if (rgbMode_ == Marquee || rgbMode_ == RainbowMarquee) {
    const uint32_t elapsed = now - effectStartedAt_;
    const uint32_t phase = elapsed % (LED_MARQUEE_STEP_MS * KEY_COUNT);
    const uint8_t baseHue = (elapsed % LED_COLOR_CYCLE_PERIOD_MS) * 256 / LED_COLOR_CYCLE_PERIOD_MS;
    const uint32_t head = phase * 256 / LED_MARQUEE_STEP_MS;
    for (uint8_t position = 0; position < KEY_COUNT; ++position) {
      const uint32_t ahead = (position * 256 + KEY_COUNT * 256 - head) % (KEY_COUNT * 256);
      uint8_t level = 0;
      if (ahead < 256) {
        const uint32_t rise = 256 - ahead;
        level = rise == 256 ? 255 : rise * rise / 256;
      }
      const uint32_t distance = (head + KEY_COUNT * 256 - position * 256) % (KEY_COUNT * 256);
      if (distance < 4 * 256) {
        const uint32_t remaining = 4 * 256 - distance;
        const uint32_t tail = 255 * remaining * remaining / (16 * 65536);
        if (tail > level) level = tail;
      }
      if (rgbMode_ == RainbowMarquee) setKeyHueLevel_(RAINBOW_KEY_ORDER[position], baseHue, level);
      else setKeyColor_(RAINBOW_KEY_ORDER[position], level);
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
  modeColor_[0] = r;
  modeColor_[1] = g;
  modeColor_[2] = b;
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
  if (!idle_) {
    if (channelFeedbackKey_ != CHANNEL_FEEDBACK_OFF) {
      uint32_t elapsed = now - channelFeedbackStartedAt_;
      if (elapsed >= 720) {
        channelFeedbackKey_ = CHANNEL_FEEDBACK_OFF;
        showPreset(accent_, rgbMode_);
      } else {
        bool on = (elapsed / 120) % 2 == 0;
        for (uint8_t key = 0; key < KEY_COUNT; ++key) {
          chain_.setPixelColor(LED_KEY_FIRST + key,
                               on && key == channelFeedbackKey_
                                 ? chain_.Color(scale(0), scale(0), scale(100))
                                 : 0);
        }
        dirty_ = true;
      }
    } else {
      updateEffects_(now);
    }
  }
  if (!dirty_ || now - lastShowMs_ < LED_TICK_INTERVAL_MS) return;
  chain_.show();
  dirty_ = false;
  lastShowMs_ = now;
}

}  // namespace navio
