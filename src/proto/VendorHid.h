#pragma once
// Phase 2 配置通道：vendor 自定义 HID 报告（usage page 0xFF00，双向 64 字节）
// 挂在与键盘/鼠标/消费控制同一 HID 复合接口下，主机端按 usage page 过滤（WebHID/HIDAPI）。
// 报告收发经 ConfigProto 帧协议处理（D14），本类只管字节搬运。
#include <functional>

#include "USB.h"
#include "USBHID.h"

#if CONFIG_TINYUSB_HID_ENABLED

namespace navio {

constexpr size_t VENDOR_REPORT_SIZE = 64;

class VendorHid : public USBHIDDevice {
 public:
  void begin();  // 注册到 USB HID 复合设备

  // 设备→主机（阻塞发送，超时 100ms）
  bool sendReport(const uint8_t* data, size_t len);

  // 主机→设备输出报告回调（USBHIDDevice 框架调用，report_id 已由框架剥离？——实测确认，
  // TinyUSB 路径下 buffer 含 report id 字节时 len 会多 1，ConfigProto 负责容错）
  void onHostOutput(const uint8_t* data, size_t len);

  // ConfigProto 注册的帧处理器（lambda 捕获 this，用 std::function）
  std::function<void(const uint8_t*, size_t)> onFrame = nullptr;

  // USBHIDDevice 实现。注意框架路由怪癖：带 report-id 的 OUTPUT SET_REPORT 会被
  // 投到 _onSetFeature 分支（USBHID.cpp tud_hid_set_report_cb 仅 report_id=0 走
  // _onOutput），因此两个回调都必须转发，否则主机输出被静默丢弃
  uint16_t _onGetDescriptor(uint8_t* buffer) override;
  void _onOutput(uint8_t report_id, const uint8_t* buffer, uint16_t len) override {
    (void)report_id;
    onHostOutput(buffer, len);
  }
  void _onSetFeature(uint8_t report_id, const uint8_t* buffer, uint16_t len) override {
    (void)report_id;
    onHostOutput(buffer, len);
  }

 private:
  USBHID hid_;
  bool begun_ = false;
};

}  // namespace navio

#endif  // CONFIG_TINYUSB_HID_ENABLED
