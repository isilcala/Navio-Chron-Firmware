#include "proto/VendorHid.h"

#include <Arduino.h>

#if CONFIG_TINYUSB_HID_ENABLED

namespace navio {

namespace {

constexpr uint8_t REPORT_ID_VENDOR = 6;
constexpr uint8_t kVendorDescriptor[] = {
    0x06, 0x00, 0xFF,  // Usage Page (Vendor Defined 0xFF00)
    0x09, 0x01,        // Usage (0x01)
    0xA1, 0x01,        // Collection (Application)
    0x85, REPORT_ID_VENDOR,
    0x15, 0x00,        //   Logical Minimum (0)
    0x26, 0xFF, 0x00,  //   Logical Maximum (255)
    0x75, 0x08,        //   Report Size (8 bits)
    0x95, VENDOR_REPORT_SIZE,
    0x09, 0x02,        //   Usage (0x02)
    0x81, 0x02,        //   Input (Data, Variable, Absolute)
    0x09, 0x03,        //   Usage (0x03)
    0x91, 0x02,        //   Output (Data, Variable, Absolute)
    0xC0               // End Collection
};

}  // namespace

VendorHid* VendorHid::s_self = nullptr;

bool VendorHid::begin() {
  if (begun_) return true;
  if (!TinyUSBDevice.isInitialized()) TinyUSBDevice.begin();
  s_self = this;
  rxQueue_ = xQueueCreate(4, sizeof(Frame));
  if (!rxQueue_) return false;

  hid_.setReportDescriptor(kVendorDescriptor, sizeof(kVendorDescriptor));
  hid_.setBootProtocol(HID_ITF_PROTOCOL_NONE);
  hid_.setPollInterval(1);
  hid_.enableOutEndpoint(true);
  hid_.setReportCallback(nullptr, onSetReport);
  begun_ = hid_.begin();
  if (!begun_) {
    vQueueDelete(rxQueue_);
    rxQueue_ = nullptr;
  }
  return begun_;
}

bool VendorHid::sendReport(const uint8_t* data, size_t len) {
  if (!begun_ || !data || len != VENDOR_REPORT_SIZE) return false;
  return hid_.sendReport(REPORT_ID_VENDOR, data, len);
}

void VendorHid::onSetReport(uint8_t reportId, hid_report_type_t reportType,
                            const uint8_t* buffer, uint16_t len) {
  if (!s_self || !buffer ||
      (reportType != HID_REPORT_TYPE_OUTPUT && reportType != HID_REPORT_TYPE_INVALID)) {
    return;
  }
  if (reportId == REPORT_ID_VENDOR) {
    s_self->onHostOutput(buffer, len);
  } else if (reportId == 0 && len > 0 && buffer[0] == REPORT_ID_VENDOR) {
    s_self->onHostOutput(buffer + 1, len - 1);
  }
}

void VendorHid::onHostOutput(const uint8_t* data, size_t len) {
  if (len != VENDOR_REPORT_SIZE) return;
  Frame frame;
  memcpy(frame.data, data, len);
  frame.len = len;
  if (xQueueSend(rxQueue_, &frame, 0) != pdTRUE) {
    droppedFrames_.fetch_add(1, std::memory_order_relaxed);
  }
}

void VendorHid::poll() {
  if (!begun_) return;
  if (uint32_t dropped = droppedFrames_.exchange(0, std::memory_order_relaxed)) {
    Serial.printf("[Navio] Vendor HID queue overflow: %lu dropped\n",
                  static_cast<unsigned long>(dropped));
  }
  Frame frame;
  while (xQueueReceive(rxQueue_, &frame, 0) == pdTRUE) {
    if (onFrame) onFrame(frame.data, frame.len);
  }
}

}  // namespace navio

#endif  // CONFIG_TINYUSB_HID_ENABLED
