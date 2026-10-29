#pragma once

#include <Arduino.h>

namespace navio {

constexpr size_t OTA_BLOCK_MAX = 2044;
constexpr uint32_t OTA_SESSION_TIMEOUT_MS = 30000;

enum class OtaSessionState : uint8_t { Idle = 0, Receiving = 1, ReadyToReboot = 2 };
enum class OtaImageState : uint8_t {
  Unknown = 0,
  Valid = 1,
  PendingVerify = 2,
  Invalid = 3,
  Aborted = 4,
  New = 5,
  Undefined = 6,
};
enum class OtaError : uint8_t {
  None,
  BadPayload,
  Overflow,
  BadSeq,
  BadState,
  Checksum,
  FlashFailure,
  ImageInvalid,
};

struct OtaStatus {
  OtaSessionState sessionState = OtaSessionState::Idle;
  uint8_t updateError = 0;
  uint8_t targetSlot = 0xFF;
  uint8_t runningSlot = 0xFF;
  uint32_t imageSize = 0;
  uint32_t received = 0;
  OtaImageState runningImageState = OtaImageState::Unknown;
};

class OtaManager {
 public:
  void poll();
  void touch();
  bool isBusy() const { return state_ != OtaSessionState::Idle; }
  OtaSessionState sessionState() const { return state_; }
  uint8_t errorDetail() const { return errorDetail_; }

  OtaError begin(uint32_t imageSize, const uint8_t* sha256, uint8_t& targetSlot);
  OtaError write(uint32_t offset, const uint8_t* data, size_t len, uint32_t& nextOffset);
  OtaError finish(uint8_t& targetSlot);
  OtaError abort();
  OtaError reboot() const;
  OtaError confirm(OtaImageState& imageState);
  OtaStatus status() const;
  OtaImageState runningImageState() const;

 private:
  void resetSession_();
  OtaError failUpdate_(OtaError error);

  OtaSessionState state_ = OtaSessionState::Idle;
  uint32_t imageSize_ = 0;
  uint32_t received_ = 0;
  uint32_t lastMs_ = 0;
  uint8_t targetSlot_ = 0xFF;
  uint8_t updateError_ = 0;
  uint8_t errorDetail_ = 0;
};

}  // namespace navio
