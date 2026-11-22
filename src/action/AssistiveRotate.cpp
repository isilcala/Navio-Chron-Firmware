#include "action/AssistiveRotate.h"

#include "Config.h"

namespace navio {

namespace {

constexpr uint8_t MOUSE_LEFT = 1 << 0;
constexpr uint8_t MOUSE_RIGHT = 1 << 1;
constexpr uint8_t MOUSE_MIDDLE = 1 << 2;

bool due(uint32_t now, uint32_t deadline) {
  return static_cast<int32_t>(now - deadline) >= 0;
}

}  // namespace

void AssistiveRotate::toggle(ITransport& transport, uint32_t now) {
  if (stage_ == Stage::Idle) {
    transport_ = &transport;
    transport_->mouseReport(MOUSE_MIDDLE, 0, 0);
    stage_ = Stage::ReleaseActivator;
    deadline_ = now + ASSISTIVE_ROTATE_CLICK_MS;
  } else if (stage_ == Stage::Active && transport_ == &transport) {
    transport_->mouseReport(MOUSE_RIGHT, 0, 0);
    stage_ = Stage::ReleaseExit;
    deadline_ = now + ASSISTIVE_ROTATE_CLICK_MS;
  }
}

void AssistiveRotate::rotate(ITransport& transport, int8_t direction) {
  if (stage_ != Stage::Active || transport_ != &transport || !direction) return;
  transport_->mouseReport(0, direction * ASSISTIVE_ROTATE_STEP, 0);
}

void AssistiveRotate::tick(uint32_t now) {
  if (!transport_ || !due(now, deadline_)) return;
  switch (stage_) {
    case Stage::ReleaseActivator:
      transport_->mouseReport(0, 0, 0);
      stage_ = Stage::ConfirmCenter;
      deadline_ = now + ASSISTIVE_ROTATE_ENTER_WAIT_MS;
      break;
    case Stage::ConfirmCenter:
      transport_->mouseReport(MOUSE_LEFT, 0, 0);
      stage_ = Stage::ReleaseCenter;
      deadline_ = now + ASSISTIVE_ROTATE_CLICK_MS;
      break;
    case Stage::ReleaseCenter:
      transport_->mouseReport(0, 0, 0);
      stage_ = Stage::Active;
      break;
    case Stage::ReleaseExit:
      transport_->mouseReport(0, 0, 0);
      stage_ = Stage::Idle;
      transport_ = nullptr;
      break;
    default:
      break;
  }
}

void AssistiveRotate::reset() {
  if (transport_ && stage_ != Stage::Idle) {
    transport_->mouseReport(MOUSE_RIGHT, 0, 0);
    transport_->mouseReport(0, 0, 0);
  }
  transport_ = nullptr;
  stage_ = Stage::Idle;
}

}  // namespace navio
