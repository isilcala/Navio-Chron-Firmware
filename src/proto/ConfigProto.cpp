#include "proto/ConfigProto.h"

#if CONFIG_TINYUSB_HID_ENABLED
#include <string.h>

#include "proto/Crc.h"

namespace navio {

namespace {

constexpr uint8_t kMagic = 0x4E;
constexpr uint8_t kFragmentMax = 36;
constexpr uint32_t kTransactionTimeoutMs = 3000;

uint16_t readLe16(const uint8_t* data) {
  return static_cast<uint16_t>(data[0]) | (static_cast<uint16_t>(data[1]) << 8);
}

void writeLe16(uint8_t* out, uint16_t value) {
  out[0] = static_cast<uint8_t>(value);
  out[1] = static_cast<uint8_t>(value >> 8);
}

uint8_t fragmentsFor(size_t bodyLength) {
  return static_cast<uint8_t>((4 + bodyLength + 57) / 58);
}

}  // namespace

void ConfigProto::begin(VendorHid* port) {
  port_ = port;
  port->onFrame = [this](const uint8_t* d, size_t l) { handleFrame(d, l); };
}

void ConfigProto::poll() {
  uint32_t now = millis();
  if (rxActive_ && now - rxLastMs_ >= kTransactionTimeoutMs) resetRx_();
  if (txActive_ && now - txLastMs_ >= kTransactionTimeoutMs) resetTx_();
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
  if (seq == 0) {
    resetRx_();
    resetTx_();
    completedValid_ = false;
    acceptFrame_(cmd, seq, total, payload);
    return;
  }
  if (completedValid_ && cmd == completedCmd_ && seq == completedSeq_ &&
      total == completedTotal_) {
    respondToCommand_();
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

  completedCmd_ = cmd;
  completedSeq_ = seq;
  completedTotal_ = total;
  if (rxLen_ != rxBodyLength_ || crc16(rxBuf_, rxLen_) != rxBodyCrc16_) {
    resetRx_();
    sendErr_(cmd, seq, ERR_CHECKSUM);
    return;
  }
  completedValid_ = true;
  resetRx_();
  respondToCommand_();
}

void ConfigProto::respondToCommand_() {
  uint8_t cmd = completedCmd_;
  uint8_t seq = completedSeq_;
  switch (cmd) {
    case CMD_HELLO: {
      static const char info[] =
          "{\"proto\":2,\"fw\":\"" NAVIO_CHRON_FW_VERSION "\",\"name\":\"Navio Chron\"}";
      sendAck_(cmd, seq, STATUS_OK, reinterpret_cast<const uint8_t*>(info), strlen(info));
      break;
    }
    case CMD_GET_INFO: {
      static const char caps[] =
          "{\"record\":1,\"maxBody\":2048,\"maxPresets\":6,"
          "\"cmds\":[1,2,3,4,5,6,7,8,9]}";
      sendMore_(cmd, seq, reinterpret_cast<const uint8_t*>(caps), strlen(caps));
      break;
    }
    default:
      sendErr_(cmd, seq, ERR_NOT_IMPLEMENTED);
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
