#pragma once
// Navio Config Protocol v2：线上格式与状态机语义见 docs/PROTOCOL.md。
#include <Arduino.h>
#include <functional>

#include "PresetManager.h"
#include "proto/VendorHid.h"

#if CONFIG_TINYUSB_HID_ENABLED

namespace navio {

constexpr size_t PROTO_BODY_MAX = 2048;

enum ProtoCmd : uint8_t {
  CMD_HELLO = 0x01,
  CMD_GET_INFO = 0x02,
  CMD_GET_PRESETS = 0x03,
  CMD_WRITE_PRESET = 0x04,
  CMD_DELETE = 0x05,
  CMD_MOVE = 0x06,
  CMD_LED_PREVIEW = 0x07,
  CMD_READ_PRESET = 0x08,
  CMD_READ_CHUNK = 0x09,
  CMD_ACK = 0x40,
  CMD_ERR = 0x41,
};

enum ProtoErr : uint8_t {
  ERR_NONE = 0,
  ERR_BAD_MAGIC = 1,
  ERR_NOT_IMPLEMENTED = 2,
  ERR_BAD_SEQ = 3,
  ERR_OVERFLOW = 4,
  ERR_CHECKSUM = 5,
  ERR_BAD_TOTAL = 6,
  ERR_TIMEOUT = 7,
  ERR_BAD_STATE = 8,
  ERR_BAD_PAYLOAD = 9,
  ERR_NVS_FAILURE = 10,
  ERR_UNSUPPORTED_VERSION = 11,
};

enum ProtoStatus : uint8_t { STATUS_OK = 0, STATUS_CHUNK = 1, STATUS_MORE = 2 };

class ConfigProto {
 public:
  void begin(VendorHid* port, PresetManager* presets,
             std::function<void()> onBeforeMutation,
             std::function<void()> onAfterMutation);
  void poll();
  void handleFrame(const uint8_t* data, size_t len);

 private:
  bool sendMessage_(uint8_t cmd, uint8_t seq, const uint8_t* body, size_t len);
  bool sendAck_(uint8_t echoCmd, uint8_t seq, uint8_t status,
                const uint8_t* data = nullptr, size_t len = 0);
  bool sendMore_(uint8_t echoCmd, uint8_t seq, const uint8_t* data, size_t len);
  bool sendChunk_(uint8_t seq);
  bool sendErr_(uint8_t echoCmd, uint8_t seq, uint8_t errCode, uint8_t detail = 0);
  void acceptFrame_(uint8_t cmd, uint8_t seq, uint8_t total, const uint8_t* payload);
  void completeRequest_();
  void respondToCommand_();
  void handleReadChunk_(uint8_t seq, uint8_t total, const uint8_t* payload);
  void resetRx_();
  void resetTx_();

  VendorHid* port_ = nullptr;
  PresetManager* presets_ = nullptr;
  std::function<void()> onBeforeMutation_;
  std::function<void()> onAfterMutation_;

  uint8_t rxBuf_[PROTO_BODY_MAX];
  uint16_t rxBodyLength_ = 0;
  uint16_t rxBodyCrc16_ = 0;
  uint16_t rxLen_ = 0;
  uint32_t rxLastMs_ = 0;
  uint8_t rxCmd_ = 0;
  uint8_t rxTotal_ = 0;
  uint8_t rxExpectedSeq_ = 0;
  bool rxActive_ = false;

  uint8_t txBuf_[PROTO_BODY_MAX];
  uint16_t txBodyLength_ = 0;
  uint16_t txBodyCrc16_ = 0;
  uint32_t txLastMs_ = 0;
  uint8_t txTotal_ = 0;
  uint8_t txExpectedSeq_ = 0;
  bool txActive_ = false;

  uint8_t completedCmd_ = 0;
  uint8_t completedSeq_ = 0;
  uint8_t completedTotal_ = 0;
  uint16_t completedBodyLength_ = 0;
  bool completedValid_ = false;
};

}  // namespace navio

#endif  // CONFIG_TINYUSB_HID_ENABLED
