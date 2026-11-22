#pragma once

#include <Arduino.h>

#include "hid/ITransport.h"

namespace navio {

class AssistiveRotate {
 public:
  void toggle(ITransport& transport, uint32_t now);
  void rotate(ITransport& transport, int8_t direction);
  void tick(uint32_t now);
  void reset();

  bool active() const { return stage_ == Stage::Active; }

 private:
  enum class Stage : uint8_t {
    Idle,
    ReleaseActivator,
    ConfirmCenter,
    ReleaseCenter,
    Active,
    ReleaseExit,
  };

  ITransport* transport_ = nullptr;
  Stage stage_ = Stage::Idle;
  uint32_t deadline_ = 0;
};

}  // namespace navio
