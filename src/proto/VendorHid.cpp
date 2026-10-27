#include "proto/VendorHid.h"

#if CONFIG_TINYUSB_HID_ENABLED
#include "USBHID.h"

namespace navio {

// vendor-defined usage page 0xFF00 / usage 0x0001，Report ID = HID_REPORT_ID_VENDOR，
// 输入/输出报告各 64 字节（与 QMK raw HID、VIA 同风格）
static const uint8_t kVendorReportDescriptor[] = {
    0x06, 0x00, 0xFF,  // Usage Page (Vendor Defined 0xFF00)
    0x09, 0x01,        // Usage (0x01)
    0xA1, 0x01,        // Collection (Application)
    0x85, 0x06,        //   Report ID (6 = HID_REPORT_ID_VENDOR)
    0x15, 0x00,        //   Logical Minimum (0)
    0x26, 0xFF, 0x00,  //   Logical Maximum (255)
    0x75, 0x08,        //   Report Size (8 bits)
    0x95, 0x40,        //   Report Count (64)
    0x09, 0x02,        //   Usage (0x02)
    0x81, 0x02,        //   Input (Data, Variable, Absolute) — 设备→主机 64B
    0x09, 0x03,        //   Usage (0x03)
    0x91, 0x02,        //   Output (Data, Variable, Absolute) — 主机→设备 64B
    0xC0               // End Collection
};

void VendorHid::begin() {
  if (begun_) return;
  begun_ = true;
  hid_.addDevice(this, sizeof(kVendorReportDescriptor));
  hid_.begin();
}

uint16_t VendorHid::_onGetDescriptor(uint8_t* buffer) {
  memcpy(buffer, kVendorReportDescriptor, sizeof(kVendorReportDescriptor));
  return sizeof(kVendorReportDescriptor);
}

bool VendorHid::sendReport(const uint8_t* data, size_t len) {
  if (len > VENDOR_REPORT_SIZE) len = VENDOR_REPORT_SIZE;
  return hid_.SendReport(0x06, data, len);
}

void VendorHid::onHostOutput(const uint8_t* data, size_t len) {
  if (onFrame && len > 0) onFrame(data, len);
}

}  // namespace navio

#endif  // CONFIG_TINYUSB_HID_ENABLED
