#include "hid/UsbTransport.h"

#include "USB.h"
#include "USBHIDConsumerControl.h"
#include "USBHIDKeyboard.h"
#include "USBHIDMouse.h"

namespace navio {

static USBHIDKeyboard keyboard;
static USBHIDMouse mouse;
static USBHIDConsumerControl consumer;

void UsbTransport::begin() {
  // 与上游一致的 VID/PID（DIY 设备惯例；HID 类驱动，Win/macOS 免驱）
  USB.VID(0xCAFE);
  USB.PID(0xBEEF);
  keyboard.begin();
  mouse.begin();
  consumer.begin();
  USB.begin();
}

bool UsbTransport::isConnected() {
  // TODO(ble): 接入 BLE 时用 TinyUSB 挂载状态（tud_ready）做 USB/BLE 自动选择；
  // Phase 1 只有 USB 一种传输，视为常开
  return true;
}

// USBHIDKeyboard 的 pressRaw 直接接受 HID Usage ID；修饰键为 0xE0-0xE7
static void applyMods(uint8_t modMask, bool press) {
  for (uint8_t i = 0; i < 8; ++i) {
    if (modMask & (1u << i)) {
      uint8_t code = 0xE0 + i;
      if (press)
        keyboard.pressRaw(code);
      else
        keyboard.releaseRaw(code);
    }
  }
}

void UsbTransport::pressChord(uint8_t modMask, uint16_t usage) {
  applyMods(modMask, true);
  if (usage) keyboard.pressRaw(static_cast<uint8_t>(usage));
}

void UsbTransport::releaseChord(uint8_t modMask, uint16_t usage) {
  if (usage) keyboard.releaseRaw(static_cast<uint8_t>(usage));
  applyMods(modMask, false);
}

void UsbTransport::releaseAll() {
  keyboard.releaseAll();
  consumerRelease();
}

void UsbTransport::consumerPress(uint16_t usage) {
  consumer.press(usage);
}

void UsbTransport::consumerRelease() {
  consumer.release();
}

void UsbTransport::mouseWheel(int8_t dy) {
  mouse.move(0, 0, dy, 0);
}

}  // namespace navio
