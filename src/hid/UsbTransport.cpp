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
uint8_t kbMods = 0;
uint8_t kbKeys[6] = {};

bool beginHid(Adafruit_USBD_HID& hid, const uint8_t* descriptor, size_t len,
              hid_interface_protocol_enum_t protocol) {
  hid.setReportDescriptor(descriptor, len);
  hid.setBootProtocol(protocol);
  hid.setPollInterval(1);
  return hid.begin();
}

int kbSlotFor(uint8_t usage, bool allocate) {
  for (int i = 0; i < 6; ++i) {
    if (kbKeys[i] == usage) return i;
    if (allocate && kbKeys[i] == 0) return i;
  }
  return -1;
}

void sendKeyboardReport() {
  if (usbReady) keyboard.keyboardReport(REPORT_ID_KEYBOARD, kbMods, kbKeys);
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

void UsbTransport::pressChord(uint8_t modMask, uint16_t usage) {
  kbMods |= modMask;
  if (usage) {
    int slot = kbSlotFor(static_cast<uint8_t>(usage), true);
    if (slot < 0) return;
    kbKeys[slot] = static_cast<uint8_t>(usage);
  }
  sendKeyboardReport();
}

void UsbTransport::releaseChord(uint8_t modMask, uint16_t usage) {
  kbMods &= ~modMask;
  if (usage) {
    int slot = kbSlotFor(static_cast<uint8_t>(usage), false);
    if (slot >= 0) kbKeys[slot] = 0;
  }
  sendKeyboardReport();
}

void UsbTransport::releaseAll() {
  kbMods = 0;
  memset(kbKeys, 0, sizeof(kbKeys));
  sendKeyboardReport();
  consumerRelease();
}

void UsbTransport::consumerPress(uint16_t usage) {
  if (usbReady) consumer.sendReport16(REPORT_ID_CONSUMER, usage);
}

void UsbTransport::consumerRelease() {
  if (usbReady) consumer.sendReport16(REPORT_ID_CONSUMER, 0);
}

void UsbTransport::mouseWheel(int8_t dy) {
  if (usbReady) mouse.mouseReport(REPORT_ID_MOUSE, 0, 0, 0, dy, 0);
}

}  // namespace navio
