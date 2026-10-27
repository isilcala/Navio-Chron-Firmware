#pragma once
// Phase 2 配置协议骨架：63B 数据帧 + 命令分发。
// 当前单帧：| magic 0x4E | cmd | seq | total | payload(≤59B) |。
// 正式分片格式按 D15 加入 CRC8、整体显式长度与 CRC16 时收紧 payload 上限。
// 当前实现：HELLO（设备信息）/ GET_INFO（协议能力）最小闭环，其余命令回 NOT_IMPLEMENTED。
#include <Arduino.h>

#include "proto/VendorHid.h"

#if CONFIG_TINYUSB_HID_ENABLED

namespace navio {

enum ProtoCmd : uint8_t {
  CMD_HELLO = 0x01,        // → JSON 设备信息（一帧）
  CMD_GET_INFO = 0x02,     // → 协议/能力 JSON
  CMD_GET_PRESETS = 0x03,  // TODO(p2)
  CMD_WRITE_PRESET = 0x04, // TODO(p2)
  CMD_DELETE = 0x05,       // TODO(p2)
  CMD_MOVE = 0x06,         // TODO(p2)
  CMD_LED_PREVIEW = 0x07,  // TODO(p2)
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
};

class ConfigProto {
 public:
  void begin(VendorHid* port);
  // VendorHid 报告回调（注册给 VendorHid::onFrame）
  void handleFrame(const uint8_t* data, size_t len);

 private:
  bool sendSingle_(uint8_t cmd, const uint8_t* payload, size_t len);
  void sendErr_(uint8_t errCode, uint8_t aboutCmd);
  VendorHid* port_ = nullptr;

  // 分片重组缓冲（写入类大包）
  uint8_t rxBuf_[1024];
  uint16_t rxLen_ = 0;
  uint8_t rxCmd_ = 0, rxTotal_ = 0;
  bool rxActive_ = false;
};

}  // namespace navio

#endif  // CONFIG_TINYUSB_HID_ENABLED
