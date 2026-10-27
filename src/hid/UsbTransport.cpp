#include "hid/UsbTransport.h"

#include <FS.h>
#include <USB.h>
#include <arduino/hid/Adafruit_USBD_HID.h>

namespace navio {

namespace {

constexpr uint8_t REPORT_ID_KEYBOARD = 1;
constexpr uint8_t REPORT_ID_MOUSE = 2;
constexpr uint8_t REPORT_ID_CONSUMER = 4;

const uint8_t kKeyboardDescriptor[] = {
    TUD_HID_REPORT_DESC_KEYBOARD(HID_REPORT_ID(REPORT_ID_KEYBOARD))};
const uint8_t kMouseDescriptor[] = {
    TUD_HID_REPORT_DESC_MOUSE(HID_REPORT_ID(REPORT_ID_MOUSE))};
const uint8_t kConsumerDescriptor[] = {
    TUD_HID_REPORT_DESC_CONSUMER(HID_REPORT_ID(REPORT_ID_CONSUMER))};

Adafruit_USBD_HID keyboard;
Adafruit_USBD_HID mouse;
Adafruit_USBD_HID consumer;
bool usbReady = false;

bool beginHid(Adafruit_USBD_HID& hid, const uint8_t* descriptor, size_t len,
              hid_interface_protocol_enum_t protocol) {
  hid.setReportDescriptor(descriptor, len);
  hid.setBootProtocol(protocol);
  hid.setPollInterval(1);
  return hid.begin();
}

}  // namespace

void UsbTransport::begin() {
  TinyUSBDevice.setID(0xCAFE, 0xBEEF);
  TinyUSBDevice.setManufacturerDescriptor("Navio");
  TinyUSBDevice.setProductDescriptor("Navio Chron");
  usbReady = beginHid(keyboard, kKeyboardDescriptor, sizeof(kKeyboardDescriptor),
                      HID_ITF_PROTOCOL_KEYBOARD) &&
             beginHid(mouse, kMouseDescriptor, sizeof(kMouseDescriptor),
                      HID_ITF_PROTOCOL_MOUSE) &&
             beginHid(consumer, kConsumerDescriptor, sizeof(kConsumerDescriptor),
                      HID_ITF_PROTOCOL_NONE);
  if (!usbReady) {
    Serial.println("[Navio] USB HID interface registration failed");
    return;
  }

  if (!USB.begin()) {
    usbReady = false;
    Serial.println("[Navio] USB initialization failed");
  }
}

bool UsbTransport::isConnected() {
  return usbReady && TinyUSBDevice.mounted() && !TinyUSBDevice.suspended();
}

void UsbTransport::sendKeyboardReport_() {
  if (!usbReady) return;
  uint8_t keys[6];
  memcpy(keys, state_.keys(), sizeof(keys));
  keyboard.keyboardReport(REPORT_ID_KEYBOARD, state_.mods(), keys);
}

void UsbTransport::pressChord(uint8_t modMask, uint16_t usage) {
  state_.pressChord(modMask, usage);
  sendKeyboardReport_();
}

void UsbTransport::releaseChord(uint8_t modMask, uint16_t usage) {
  state_.releaseChord(modMask, usage);
  sendKeyboardReport_();
}

void UsbTransport::releaseAll() {
  state_.releaseAll();
  sendKeyboardReport_();
  sendConsumerReport_();
}

void UsbTransport::consumerPress(uint16_t usage) {
  state_.pressConsumer(usage);
  sendConsumerReport_();
}

void UsbTransport::consumerRelease(uint16_t usage) {
  state_.releaseConsumer(usage);
  sendConsumerReport_();
}

void UsbTransport::sendConsumerReport_() {
  if (usbReady) consumer.sendReport16(REPORT_ID_CONSUMER, state_.consumerUsage());
}

void UsbTransport::mouseWheel(int8_t dy) {
  if (usbReady) mouse.mouseReport(REPORT_ID_MOUSE, 0, 0, 0, dy, 0);
}

}  // namespace navio
