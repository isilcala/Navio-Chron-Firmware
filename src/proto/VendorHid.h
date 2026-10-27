#pragma once
// 独立 Vendor HID 接口：usage page 0xFF00，Report ID 6，双向 63 字节数据
#include <functional>

#include <arduino/hid/Adafruit_USBD_HID.h>

#if CONFIG_TINYUSB_HID_ENABLED

namespace navio {

constexpr size_t VENDOR_REPORT_SIZE = 63;

class VendorHid {
 public:
  bool begin();
  bool sendReport(const uint8_t* data, size_t len);
  void poll();

  std::function<void(const uint8_t*, size_t)> onFrame = nullptr;

 private:
  struct Frame {
    uint8_t data[VENDOR_REPORT_SIZE];
    uint8_t len;
  };

  static VendorHid* s_self;
  static void onSetReport(uint8_t reportId, hid_report_type_t reportType,
                          const uint8_t* buffer, uint16_t len);
  void onHostOutput(const uint8_t* data, size_t len);

  Adafruit_USBD_HID hid_;
  QueueHandle_t rxQueue_ = nullptr;
  bool begun_ = false;
  volatile uint32_t droppedFrames_ = 0;
};

}  // namespace navio

#endif  // CONFIG_TINYUSB_HID_ENABLED
