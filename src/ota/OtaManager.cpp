#include "ota/OtaManager.h"

#include <Update.h>
#include <esp_ota_ops.h>

#include "ByteOrder.h"

namespace navio {

namespace {

uint8_t slotOf(const esp_partition_t* partition) {
  if (!partition) return 0xFF;
  if (partition->subtype == ESP_PARTITION_SUBTYPE_APP_OTA_0) return 0;
  if (partition->subtype == ESP_PARTITION_SUBTYPE_APP_OTA_1) return 1;
  return 0xFF;
}

OtaError updateError(uint8_t error, bool finishing) {
  if (error == UPDATE_ERROR_SPACE || error == UPDATE_ERROR_SIZE) return OtaError::Overflow;
  if (error == UPDATE_ERROR_MD5 || error == UPDATE_ERROR_SHA256) return OtaError::Checksum;
  if (error == UPDATE_ERROR_MAGIC_BYTE || error == UPDATE_ERROR_SIGN ||
      error == UPDATE_ERROR_DECRYPT || (finishing && error == UPDATE_ERROR_READ)) {
    return OtaError::ImageInvalid;
  }
  return OtaError::FlashFailure;
}

}  // namespace

void OtaManager::resetSession_() {
  state_ = OtaSessionState::Idle;
  imageSize_ = 0;
  received_ = 0;
  lastMs_ = 0;
  targetSlot_ = 0xFF;
}

OtaError OtaManager::failUpdate_(OtaError error) {
  updateError_ = static_cast<uint8_t>(Update.getError());
  errorDetail_ = updateError_;
  Update.abort();
  resetSession_();
  return error;
}

void OtaManager::poll() {
  if (state_ == OtaSessionState::Receiving && millis() - lastMs_ >= OTA_SESSION_TIMEOUT_MS) {
    Update.abort();
    resetSession_();
  }
}

void OtaManager::touch() {
  if (state_ == OtaSessionState::Receiving) lastMs_ = millis();
}

OtaError OtaManager::begin(uint32_t imageSize, const uint8_t* sha256, uint8_t& targetSlot) {
  if (state_ == OtaSessionState::ReadyToReboot || runningImageState() == OtaImageState::PendingVerify) {
    return OtaError::BadState;
  }
  if (!imageSize || !sha256) return OtaError::BadPayload;

  if (state_ == OtaSessionState::Receiving) {
    Update.abort();
    resetSession_();
  }
  updateError_ = 0;
  errorDetail_ = 0;

  const esp_partition_t* partition = esp_ota_get_next_update_partition(nullptr);
  if (!partition) return OtaError::FlashFailure;
  if (imageSize > partition->size) return OtaError::Overflow;
  if (!Update.begin(imageSize, U_FLASH)) return failUpdate_(updateError(Update.getError(), false));

  char expected[65];
  static const char hex[] = "0123456789abcdef";
  for (size_t i = 0; i < 32; ++i) {
    expected[i * 2] = hex[sha256[i] >> 4];
    expected[i * 2 + 1] = hex[sha256[i] & 0x0F];
  }
  expected[64] = 0;
  if (!Update.setSHA256(expected)) return failUpdate_(OtaError::FlashFailure);

  targetSlot_ = slotOf(partition);
  if (targetSlot_ == 0xFF) return failUpdate_(OtaError::FlashFailure);
  imageSize_ = imageSize;
  received_ = 0;
  state_ = OtaSessionState::Receiving;
  lastMs_ = millis();
  targetSlot = targetSlot_;
  return OtaError::None;
}

OtaError OtaManager::write(uint32_t offset, const uint8_t* data, size_t len,
                           uint32_t& nextOffset) {
  if (state_ != OtaSessionState::Receiving) return OtaError::BadState;
  if (!data || len == 0 || len > OTA_BLOCK_MAX) return OtaError::BadPayload;
  if (offset != received_) return OtaError::BadSeq;
  if (offset > imageSize_ || len > imageSize_ - offset) return OtaError::Overflow;

  size_t written = Update.write(const_cast<uint8_t*>(data), len);
  if (written != len) return failUpdate_(updateError(Update.getError(), false));
  received_ += len;
  lastMs_ = millis();
  nextOffset = received_;
  return OtaError::None;
}

OtaError OtaManager::finish(uint8_t& targetSlot) {
  if (state_ != OtaSessionState::Receiving || received_ != imageSize_) return OtaError::BadState;
  if (!Update.end(false)) return failUpdate_(updateError(Update.getError(), true));
  state_ = OtaSessionState::ReadyToReboot;
  updateError_ = 0;
  errorDetail_ = 0;
  targetSlot = targetSlot_;
  return OtaError::None;
}

OtaError OtaManager::abort() {
  if (state_ == OtaSessionState::ReadyToReboot) return OtaError::BadState;
  if (state_ == OtaSessionState::Receiving) Update.abort();
  resetSession_();
  return OtaError::None;
}

OtaError OtaManager::reboot() const {
  return state_ == OtaSessionState::ReadyToReboot ? OtaError::None : OtaError::BadState;
}

OtaError OtaManager::confirm(OtaImageState& imageState) {
  OtaImageState current = runningImageState();
  if (current == OtaImageState::Valid) {
    imageState = current;
    return OtaError::None;
  }
  if (current != OtaImageState::PendingVerify) return OtaError::BadState;
  esp_err_t result = esp_ota_mark_app_valid_cancel_rollback();
  if (result != ESP_OK) {
    errorDetail_ = static_cast<uint8_t>(result);
    return OtaError::FlashFailure;
  }
  imageState = OtaImageState::Valid;
  return OtaError::None;
}

OtaImageState OtaManager::runningImageState() const {
  const esp_partition_t* running = esp_ota_get_running_partition();
  esp_ota_img_states_t state;
  esp_err_t result = esp_ota_get_state_partition(running, &state);
  if (result == ESP_ERR_NOT_FOUND) return OtaImageState::Undefined;
  if (result != ESP_OK) return OtaImageState::Unknown;
  switch (state) {
    case ESP_OTA_IMG_VALID: return OtaImageState::Valid;
    case ESP_OTA_IMG_PENDING_VERIFY: return OtaImageState::PendingVerify;
    case ESP_OTA_IMG_INVALID: return OtaImageState::Invalid;
    case ESP_OTA_IMG_ABORTED: return OtaImageState::Aborted;
    case ESP_OTA_IMG_NEW: return OtaImageState::New;
    case ESP_OTA_IMG_UNDEFINED: return OtaImageState::Undefined;
    default: return OtaImageState::Unknown;
  }
}

OtaStatus OtaManager::status() const {
  OtaStatus out;
  out.sessionState = state_;
  out.updateError = updateError_;
  out.targetSlot = targetSlot_;
  out.runningSlot = slotOf(esp_ota_get_running_partition());
  out.imageSize = imageSize_;
  out.received = received_;
  out.runningImageState = runningImageState();
  return out;
}

}  // namespace navio
