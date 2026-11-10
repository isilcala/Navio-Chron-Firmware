#pragma once
// Navio Config Protocol v2：线上格式与状态机语义见 docs/PROTOCOL.md。
#include <Arduino.h>
#include <functional>

#include "PresetManager.h"
#include "hid/BleBondManager.h"
#include "ota/OtaManager.h"
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
  CMD_OTA_BEGIN = 0x0A,
  CMD_OTA_WRITE = 0x0B,
  CMD_OTA_FINISH = 0x0C,
  CMD_OTA_ABORT = 0x0D,
  CMD_OTA_STATUS = 0x0E,
  CMD_OTA_REBOOT = 0x0F,
  CMD_OTA_CONFIRM = 0x10,
  CMD_GET_BLE_BONDS = 0x11,
  CMD_DELETE_BLE_BOND = 0x12,
  CMD_CLEAR_BLE_BONDS = 0x13,
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
  ERR_FLASH_FAILURE = 12,
  ERR_IMAGE_INVALID = 13,
};

enum ProtoStatus : uint8_t { STATUS_OK = 0, STATUS_CHUNK = 1, STATUS_MORE = 2 };

class ConfigProto {
 public:
  void begin(VendorHid* port, PresetManager* presets, OtaManager* ota,
             IBleBondManager* bonds, std::function<void()> onBeforeMutation,
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
  bool commandAllowed_(uint8_t cmd) const;
  void finishResponse_(const uint8_t* data = nullptr, size_t len = 0);
  void finishError_(uint8_t errCode, uint8_t detail = 0);
  void finishOtaError_(OtaError error);
  void replayCompleted_();
  void handleReadChunk_(uint8_t seq, uint8_t total, const uint8_t* payload);
  void resetRx_();
  void resetTx_();

  VendorHid* port_ = nullptr;
  PresetManager* presets_ = nullptr;
  OtaManager* ota_ = nullptr;
  IBleBondManager* bonds_ = nullptr;
  std::function<void()> onBeforeMutation_;
  std::function<void()> onAfterMutation_;
  uint32_t rebootAtMs_ = 0;
  bool rebootPending_ = false;

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

  enum class CompletedResponse : uint8_t { None, Ack, More, Error };
  uint8_t completedFrame_[VENDOR_REPORT_SIZE] = {};
  uint8_t completedData_[51] = {};
  uint8_t completedCmd_ = 0;
  uint8_t completedSeq_ = 0;
  uint8_t completedDataLength_ = 0;
  uint8_t completedError_ = 0;
  uint8_t completedErrorDetail_ = 0;
  uint16_t completedBodyLength_ = 0;
  CompletedResponse completedResponse_ = CompletedResponse::None;
};

}  // namespace navio

#endif  // CONFIG_TINYUSB_HID_ENABLED
