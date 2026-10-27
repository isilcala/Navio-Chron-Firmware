#include "proto/ConfigProto.h"

#if CONFIG_TINYUSB_HID_ENABLED
#include <string.h>

namespace navio {

constexpr uint8_t kMagic = 0x4E;  // 'N'

void ConfigProto::begin(VendorHid* port) {
  port_ = port;
  port->onFrame = [this](const uint8_t* d, size_t l) { handleFrame(d, l); };
}

bool ConfigProto::sendSingle_(uint8_t cmd, const uint8_t* payload, size_t len) {
  if (len > VENDOR_REPORT_SIZE - 4) return false;
  uint8_t frame[VENDOR_REPORT_SIZE] = {0};
  frame[0] = kMagic;
  frame[1] = cmd;
  frame[2] = 0;  // seq
  frame[3] = 1;  // total
  if (payload && len) memcpy(frame + 4, payload, len);
  return port_->sendReport(frame, VENDOR_REPORT_SIZE);
}

void ConfigProto::sendErr_(uint8_t errCode, uint8_t aboutCmd) {
  uint8_t p[2] = {errCode, aboutCmd};
  sendSingle_(CMD_ERR, p, 2);
}

void ConfigProto::handleFrame(const uint8_t* data, size_t len) {
  if (len != VENDOR_REPORT_SIZE) return;
  const uint8_t* f = data;
  if (f[0] != kMagic) {
    sendErr_(ERR_BAD_MAGIC, 0);
    return;
  }
  uint8_t cmd = f[1], seq = f[2], total = f[3];
  const uint8_t* payload = f + 4;
  size_t plen = (len > 4) ? len - 4 : 0;
  if (plen > 59) plen = 59;

  switch (cmd) {
    case CMD_HELLO: {
      // 一帧即答的设备信息（后续接入 NVS 预设数后扩展）
      static char info[] = "{\"proto\":1,\"fw\":\"" NAVIO_CHRON_FW_VERSION "\",\"name\":\"Navio Chron\"}";
      sendSingle_(CMD_ACK, (const uint8_t*)info, strlen(info));
      break;
    }
    case CMD_GET_INFO: {
      static char caps[] = "{\"cmds\":[\"hello\",\"info\"],\"maxPresets\":6}";
      sendSingle_(CMD_ACK, (const uint8_t*)caps, strlen(caps));
      break;
    }
    case CMD_GET_PRESETS:
    case CMD_WRITE_PRESET:
    case CMD_DELETE:
    case CMD_MOVE:
    case CMD_LED_PREVIEW:
      sendErr_(ERR_NOT_IMPLEMENTED, cmd);
      break;
    default:
      // 多帧写入：先做重组骨架，命令实现接 JSON/NVS 时补全
      sendErr_(ERR_NOT_IMPLEMENTED, cmd);
      break;
  }
  (void)seq;
  (void)total;
  (void)payload;
  (void)plen;
  (void)rxBuf_;
  (void)rxLen_;
  (void)rxCmd_;
  (void)rxTotal_;
  (void)rxActive_;
}

}  // namespace navio

#endif  // CONFIG_TINYUSB_HID_ENABLED
