#include "proto/ConfigProto.h"

#if CONFIG_TINYUSB_HID_ENABLED
#include <string.h>

#include "ByteOrder.h"
#include "proto/Crc.h"

namespace navio {

namespace {

constexpr uint8_t kMagic = 0x4E;
constexpr uint8_t kFragmentMax = 36;
constexpr uint32_t kTransactionTimeoutMs = 3000;

uint8_t fragmentsFor(size_t bodyLength) {
  return static_cast<uint8_t>((4 + bodyLength + 57) / 58);
}

uint8_t errorForResult(PresetChangeResult result) {
  switch (result) {
    case PresetChangeResult::NotFound:
    case PresetChangeResult::Invalid:
      return ERR_BAD_PAYLOAD;
    case PresetChangeResult::Full:
      return ERR_OVERFLOW;
    case PresetChangeResult::UnsupportedVersion:
      return ERR_UNSUPPORTED_VERSION;
    case PresetChangeResult::NvsFailure:
      return ERR_NVS_FAILURE;
    case PresetChangeResult::BadState:
      return ERR_BAD_STATE;
    default:
      return ERR_NONE;
  }
}

}  // namespace

void ConfigProto::begin(VendorHid* port, PresetManager* presets, OtaManager* ota,
                        std::function<void()> onBeforeMutation,
                        std::function<void()> onAfterMutation) {
  port_ = port;
  presets_ = presets;
  ota_ = ota;
  onBeforeMutation_ = onBeforeMutation;
  onAfterMutation_ = onAfterMutation;
  port->onFrame = [this](const uint8_t* d, size_t l) { handleFrame(d, l); };
}

void ConfigProto::poll() {
  uint32_t now = millis();
  if (rxActive_ && now - rxLastMs_ >= kTransactionTimeoutMs) resetRx_();
  if (txActive_ && now - txLastMs_ >= kTransactionTimeoutMs) resetTx_();
  if (ota_) ota_->poll();
  if (rebootPending_ && static_cast<int32_t>(now - rebootAtMs_) >= 0) esp_restart();
}

void ConfigProto::resetRx_() {
  rxActive_ = false;
  rxExpectedSeq_ = 0;
  rxLen_ = 0;
}

void ConfigProto::resetTx_() {
  txActive_ = false;
  txExpectedSeq_ = 0;
}

bool ConfigProto::sendMessage_(uint8_t cmd, uint8_t seq, const uint8_t* body, size_t len) {
  if (len > 54) return false;
  uint8_t frame[VENDOR_REPORT_SIZE] = {0};
  frame[0] = kMagic;
  frame[1] = cmd;
  frame[2] = seq;
  frame[3] = 1;
  writeLe16(frame + 4, static_cast<uint16_t>(len));
  writeLe16(frame + 6, crc16(body, len));
  if (len) memcpy(frame + 8, body, len);
  frame[62] = crc8(frame, 62);
  return port_->sendReport(frame, sizeof(frame));
}

bool ConfigProto::sendAck_(uint8_t echoCmd, uint8_t seq, uint8_t status,
                           const uint8_t* data, size_t len) {
  if (len > 51) return false;
  uint8_t body[54];
  body[0] = echoCmd;
  body[1] = seq;
  body[2] = status;
  if (len) memcpy(body + 3, data, len);
  return sendMessage_(CMD_ACK, seq, body, len + 3);
}

bool ConfigProto::sendMore_(uint8_t echoCmd, uint8_t seq, const uint8_t* data, size_t len) {
  if (len <= 51) return sendAck_(echoCmd, seq, STATUS_OK, data, len);
  if (!data || len > PROTO_BODY_MAX) return false;

  memcpy(txBuf_, data, len);
  txBodyLength_ = static_cast<uint16_t>(len);
  txBodyCrc16_ = crc16(data, len);
  txTotal_ = static_cast<uint8_t>((len + 54) / 55);
  txExpectedSeq_ = 0;
  txLastMs_ = millis();
  txActive_ = true;

  uint8_t metadata[4];
  writeLe16(metadata, txBodyLength_);
  writeLe16(metadata + 2, txBodyCrc16_);
  return sendAck_(echoCmd, seq, STATUS_MORE, metadata, sizeof(metadata));
}

bool ConfigProto::sendChunk_(uint8_t seq) {
  if (!txActive_ || seq >= txTotal_) return false;
  size_t offset = static_cast<size_t>(seq) * 55;
  size_t len = txBodyLength_ - offset;
  if (len > 55) len = 55;

  uint8_t frame[VENDOR_REPORT_SIZE] = {0};
  frame[0] = kMagic;
  frame[1] = CMD_ACK;
  frame[2] = seq;
  frame[3] = txTotal_;
  frame[4] = CMD_READ_CHUNK;
  frame[5] = seq;
  frame[6] = STATUS_CHUNK;
  memcpy(frame + 7, txBuf_ + offset, len);
  frame[62] = crc8(frame, 62);
  return port_->sendReport(frame, sizeof(frame));
}

bool ConfigProto::sendErr_(uint8_t echoCmd, uint8_t seq, uint8_t errCode, uint8_t detail) {
  uint8_t body[4] = {echoCmd, seq, errCode, detail};
  return sendMessage_(CMD_ERR, seq, body, sizeof(body));
}

void ConfigProto::handleFrame(const uint8_t* data, size_t len) {
  if (len != VENDOR_REPORT_SIZE || crc8(data, 62) != data[62]) return;

  uint8_t cmd = data[1];
  uint8_t seq = data[2];
  uint8_t total = data[3];
  const uint8_t* payload = data + 4;
  if (data[0] != kMagic) {
    sendErr_(cmd, seq, ERR_BAD_MAGIC);
    return;
  }
  if (cmd == CMD_READ_CHUNK) {
    handleReadChunk_(seq, total, payload);
    return;
  }
  if (completedResponse_ != CompletedResponse::None &&
      memcmp(data, completedFrame_, VENDOR_REPORT_SIZE) == 0) {
    replayCompleted_();
    return;
  }
  if (seq == 0) {
    resetRx_();
    resetTx_();
    completedResponse_ = CompletedResponse::None;
    acceptFrame_(cmd, seq, total, payload);
    return;
  }
  if (!rxActive_) {
    sendErr_(cmd, seq, ERR_BAD_STATE);
    return;
  }
  acceptFrame_(cmd, seq, total, payload);
}

void ConfigProto::acceptFrame_(uint8_t cmd, uint8_t seq, uint8_t total,
                               const uint8_t* payload) {
  if (seq == 0) {
    if (total == 0 || total > kFragmentMax) {
      sendErr_(cmd, seq, ERR_BAD_TOTAL);
      return;
    }
    rxBodyLength_ = readLe16(payload);
    rxBodyCrc16_ = readLe16(payload + 2);
    if (rxBodyLength_ > PROTO_BODY_MAX) {
      sendErr_(cmd, seq, ERR_OVERFLOW);
      return;
    }
    if (total != fragmentsFor(rxBodyLength_)) {
      sendErr_(cmd, seq, ERR_BAD_TOTAL);
      return;
    }
    rxCmd_ = cmd;
    rxTotal_ = total;
    rxExpectedSeq_ = 0;
    rxLen_ = 0;
    rxActive_ = true;
  } else if (!rxActive_ || cmd != rxCmd_ || total != rxTotal_) {
    sendErr_(cmd, seq, ERR_BAD_STATE);
    return;
  }

  if (rxExpectedSeq_ > 0 && seq == rxExpectedSeq_ - 1) {
    rxLastMs_ = millis();
    sendAck_(cmd, seq, STATUS_CHUNK);
    return;
  }
  if (seq != rxExpectedSeq_) {
    sendErr_(cmd, seq, ERR_BAD_SEQ, rxExpectedSeq_);
    return;
  }

  size_t header = seq == 0 ? 4 : 0;
  size_t len = 58 - header;
  size_t remaining = rxBodyLength_ - rxLen_;
  if (len > remaining) len = remaining;
  if (len) memcpy(rxBuf_ + rxLen_, payload + header, len);
  rxLen_ = static_cast<uint16_t>(rxLen_ + len);
  ++rxExpectedSeq_;
  rxLastMs_ = millis();

  if (rxExpectedSeq_ < rxTotal_) {
    sendAck_(cmd, seq, STATUS_CHUNK);
    return;
  }

  completedFrame_[0] = kMagic;
  completedFrame_[1] = cmd;
  completedFrame_[2] = seq;
  completedFrame_[3] = total;
  memcpy(completedFrame_ + 4, payload, 58);
  completedFrame_[62] = crc8(completedFrame_, 62);
  completedCmd_ = cmd;
  completedSeq_ = seq;
  completedBodyLength_ = rxBodyLength_;
  bool valid = rxLen_ == rxBodyLength_ && crc16(rxBuf_, rxLen_) == rxBodyCrc16_;
  resetRx_();
  if (!valid) {
    finishError_(ERR_CHECKSUM);
    return;
  }
  completeRequest_();
}

void ConfigProto::completeRequest_() {
  uint8_t cmd = completedCmd_;
  if (!commandAllowed_(cmd)) {
    finishError_(ERR_BAD_STATE);
    return;
  }
  if (ota_ && cmd >= CMD_OTA_BEGIN && cmd <= CMD_OTA_CONFIRM) ota_->touch();
  bool mutation = cmd == CMD_WRITE_PRESET || cmd == CMD_DELETE || cmd == CMD_MOVE;
  if (mutation) {
    bool validLength = (cmd == CMD_WRITE_PRESET && completedBodyLength_ == PRESET_RECORD_SIZE) ||
                       (cmd == CMD_DELETE && completedBodyLength_ == 1) ||
                       (cmd == CMD_MOVE && completedBodyLength_ == 2);
    if (!validLength) {
      finishError_(ERR_BAD_PAYLOAD);
      return;
    }

    if (onBeforeMutation_) onBeforeMutation_();
    PresetChangeResult result = PresetChangeResult::Ok;
    if (cmd == CMD_WRITE_PRESET) {
      result = presets_->write(rxBuf_, completedBodyLength_);
    } else if (cmd == CMD_DELETE) {
      result = presets_->remove(rxBuf_[0]);
    } else {
      result = presets_->move(rxBuf_[0], rxBuf_[1]);
    }
    if (result != PresetChangeResult::Ok) {
      finishError_(errorForResult(result));
      return;
    }
    if (onAfterMutation_) onAfterMutation_();
  }
  respondToCommand_();
}

void ConfigProto::respondToCommand_() {
  switch (completedCmd_) {
    case CMD_HELLO: {
      static const char info[] =
          "{\"proto\":2,\"fw\":\"" NAVIO_CHRON_FW_VERSION "\",\"name\":\"Navio Chron\"}";
      finishResponse_(reinterpret_cast<const uint8_t*>(info), strlen(info));
      break;
    }
    case CMD_GET_INFO: {
      static const char caps[] =
          "{\"record\":1,\"maxBody\":2048,\"maxPresets\":6,"
          "\"cmds\":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]}";
      finishResponse_(reinterpret_cast<const uint8_t*>(caps), strlen(caps));
      break;
    }
    case CMD_GET_PRESETS: {
      uint8_t manifest[2 + PRESET_MAX_INSTALLED * (2 + PRESET_NAME_MAX - 1)];
      size_t len = 0;
      uint8_t count = presets_->count();
      manifest[len++] = count;
      manifest[len++] = presets_->activeId();
      for (uint8_t i = 0; i < count; ++i) {
        const InstalledPreset& preset = presets_->entryAt(i);
        manifest[len++] = preset.id;
        size_t nameLength = strnlen(preset.name, PRESET_NAME_MAX - 1);
        manifest[len++] = static_cast<uint8_t>(nameLength);
        memcpy(manifest + len, preset.name, nameLength);
        len += nameLength;
      }
      finishResponse_(manifest, len);
      break;
    }
    case CMD_READ_PRESET: {
      if (completedBodyLength_ != 1) {
        finishError_(ERR_BAD_PAYLOAD);
        break;
      }
      uint8_t record[PRESET_RECORD_SIZE];
      PresetChangeResult result = presets_->read(rxBuf_[0], record);
      if (result != PresetChangeResult::Ok) {
        finishError_(errorForResult(result));
      } else {
        finishResponse_(record, sizeof(record));
      }
      break;
    }
    case CMD_OTA_BEGIN: {
      if (completedBodyLength_ != 36) {
        finishError_(ERR_BAD_PAYLOAD);
        break;
      }
      if (onBeforeMutation_) onBeforeMutation_();
      uint8_t target = 0xFF;
      OtaError result = ota_->begin(readLe32(rxBuf_), rxBuf_ + 4, target);
      if (result != OtaError::None) {
        finishOtaError_(result);
      } else {
        uint8_t data[4] = {target, 0, 0, 0};
        writeLe16(data + 1, OTA_BLOCK_MAX);
        finishResponse_(data, sizeof(data));
      }
      break;
    }
    case CMD_OTA_WRITE: {
      if (completedBodyLength_ < 5) {
        finishError_(ERR_BAD_PAYLOAD);
        break;
      }
      uint32_t next = 0;
      OtaError result = ota_->write(readLe32(rxBuf_), rxBuf_ + 4,
                                    completedBodyLength_ - 4, next);
      if (result != OtaError::None) {
        finishOtaError_(result);
      } else {
        uint8_t data[4];
        writeLe32(data, next);
        finishResponse_(data, sizeof(data));
      }
      break;
    }
    case CMD_OTA_FINISH: {
      if (completedBodyLength_ != 0) {
        finishError_(ERR_BAD_PAYLOAD);
        break;
      }
      uint8_t target = 0xFF;
      OtaError result = ota_->finish(target);
      if (result != OtaError::None) {
        finishOtaError_(result);
      } else {
        finishResponse_(&target, 1);
      }
      break;
    }
    case CMD_OTA_ABORT: {
      if (completedBodyLength_ != 0) {
        finishError_(ERR_BAD_PAYLOAD);
        break;
      }
      OtaError result = ota_->abort();
      if (result != OtaError::None) finishOtaError_(result);
      else finishResponse_();
      break;
    }
    case CMD_OTA_STATUS: {
      if (completedBodyLength_ != 0) {
        finishError_(ERR_BAD_PAYLOAD);
        break;
      }
      OtaStatus status = ota_->status();
      uint8_t data[16] = {};
      data[0] = static_cast<uint8_t>(status.sessionState);
      data[1] = status.updateError;
      data[2] = status.targetSlot;
      data[3] = status.runningSlot;
      writeLe32(data + 4, status.imageSize);
      writeLe32(data + 8, status.received);
      data[12] = static_cast<uint8_t>(status.runningImageState);
      finishResponse_(data, sizeof(data));
      break;
    }
    case CMD_OTA_REBOOT: {
      if (completedBodyLength_ != 0) {
        finishError_(ERR_BAD_PAYLOAD);
        break;
      }
      OtaError result = ota_->reboot();
      if (result != OtaError::None) {
        finishOtaError_(result);
      } else {
        finishResponse_();
        rebootAtMs_ = millis() + 250;
        rebootPending_ = true;
      }
      break;
    }
    case CMD_OTA_CONFIRM: {
      if (completedBodyLength_ != 0) {
        finishError_(ERR_BAD_PAYLOAD);
        break;
      }
      OtaImageState state = OtaImageState::Unknown;
      OtaError result = ota_->confirm(state);
      if (result != OtaError::None) {
        finishOtaError_(result);
      } else {
        uint8_t data = static_cast<uint8_t>(state);
        finishResponse_(&data, 1);
      }
      break;
    }
    case CMD_WRITE_PRESET:
    case CMD_DELETE:
    case CMD_MOVE:
      finishResponse_();
      break;
    default:
      finishError_(ERR_NOT_IMPLEMENTED);
      break;
  }
}

bool ConfigProto::commandAllowed_(uint8_t cmd) const {
  if (!ota_) return true;
  if (cmd == CMD_HELLO || cmd == CMD_GET_INFO || cmd == CMD_OTA_STATUS) return true;
  switch (ota_->sessionState()) {
    case OtaSessionState::Receiving:
      return cmd == CMD_OTA_BEGIN || cmd == CMD_OTA_WRITE || cmd == CMD_OTA_FINISH ||
             cmd == CMD_OTA_ABORT;
    case OtaSessionState::ReadyToReboot:
      return cmd == CMD_OTA_REBOOT;
    default:
      return true;
  }
}

void ConfigProto::finishOtaError_(OtaError error) {
  uint8_t code = ERR_FLASH_FAILURE;
  uint8_t detail = 0;
  switch (error) {
    case OtaError::BadPayload: code = ERR_BAD_PAYLOAD; break;
    case OtaError::Overflow: code = ERR_OVERFLOW; break;
    case OtaError::BadSeq: code = ERR_BAD_SEQ; break;
    case OtaError::BadState: code = ERR_BAD_STATE; break;
    case OtaError::Checksum:
      code = ERR_CHECKSUM;
      detail = ota_->errorDetail();
      break;
    case OtaError::ImageInvalid:
      code = ERR_IMAGE_INVALID;
      detail = ota_->errorDetail();
      break;
    case OtaError::FlashFailure:
      detail = ota_->errorDetail();
      break;
    default: break;
  }
  finishError_(code, detail);
}

void ConfigProto::finishResponse_(const uint8_t* data, size_t len) {
  if (len > 51) {
    completedResponse_ = CompletedResponse::More;
    sendMore_(completedCmd_, completedSeq_, data, len);
    return;
  }
  if (len) memcpy(completedData_, data, len);
  completedDataLength_ = static_cast<uint8_t>(len);
  completedResponse_ = CompletedResponse::Ack;
  sendAck_(completedCmd_, completedSeq_, STATUS_OK, data, len);
}

void ConfigProto::finishError_(uint8_t errCode, uint8_t detail) {
  completedError_ = errCode;
  completedErrorDetail_ = detail;
  completedResponse_ = CompletedResponse::Error;
  sendErr_(completedCmd_, completedSeq_, errCode, detail);
}

void ConfigProto::replayCompleted_() {
  switch (completedResponse_) {
    case CompletedResponse::Ack:
      sendAck_(completedCmd_, completedSeq_, STATUS_OK, completedData_, completedDataLength_);
      break;
    case CompletedResponse::More:
      sendMore_(completedCmd_, completedSeq_, txBuf_, txBodyLength_);
      break;
    case CompletedResponse::Error:
      sendErr_(completedCmd_, completedSeq_, completedError_, completedErrorDetail_);
      break;
    default:
      break;
  }
}

void ConfigProto::handleReadChunk_(uint8_t seq, uint8_t total, const uint8_t* payload) {
  if (total != 1 || seq != 0) {
    sendErr_(CMD_READ_CHUNK, seq, ERR_BAD_TOTAL);
    return;
  }
  uint16_t bodyLength = readLe16(payload);
  uint16_t bodyCrc = readLe16(payload + 2);
  if (bodyLength != 1 || total != fragmentsFor(bodyLength)) {
    sendErr_(CMD_READ_CHUNK, seq, ERR_BAD_PAYLOAD);
    return;
  }
  if (crc16(payload + 4, bodyLength) != bodyCrc) {
    sendErr_(CMD_READ_CHUNK, seq, ERR_CHECKSUM);
    return;
  }
  if (rxActive_ || !txActive_) {
    sendErr_(CMD_READ_CHUNK, seq, ERR_BAD_STATE);
    return;
  }

  uint8_t chunkSeq = payload[4];
  bool current = chunkSeq == txExpectedSeq_;
  bool duplicate = txExpectedSeq_ > 0 && chunkSeq == txExpectedSeq_ - 1;
  if (!current && !duplicate) {
    sendErr_(CMD_READ_CHUNK, seq, ERR_BAD_SEQ, txExpectedSeq_);
    return;
  }
  if (sendChunk_(chunkSeq) && current) {
    ++txExpectedSeq_;
    txLastMs_ = millis();
  }
}

}  // namespace navio

#endif  // CONFIG_TINYUSB_HID_ENABLED
