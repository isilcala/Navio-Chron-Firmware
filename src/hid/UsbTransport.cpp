#include "hid/UsbTransport.h"

// 让 PlatformIO LDF 发现 FS 库：USB 库整体编译时（MSC 子模块）需要 FS.h，
// 而其依赖声明是 core 3.x 的 idf_component.yml 格式，PIO 读不到（core 2.x 无此问题）
#include <FS.h>

#include "USB.h"
#include "USBHIDConsumerControl.h"
#include "USBHIDKeyboard.h"
#include "USBHIDMouse.h"

namespace navio {

static USBHIDKeyboard keyboard;
static USBHIDMouse mouse;
static USBHIDConsumerControl consumer;

// USB 挂载检测：ARDUINO_USB_STARTED/STOPPED 事件（主机完成枚举 = STARTED）
static volatile bool s_usbMounted = false;
static void usbEventHandler(void* arg, esp_event_base_t base, int32_t id, void* data) {
  s_usbMounted = (id == ARDUINO_USB_STARTED_EVENT);
}

void UsbTransport::begin() {
  // 与上游一致的 VID/PID（DIY 设备惯例；HID 类驱动，Win/macOS 免驱）
  USB.VID(0xCAFE);
  USB.PID(0xBEEF);
  keyboard.begin();
  mouse.begin();
  consumer.begin();
  USB.onEvent(usbEventHandler);
  USB.begin();
}

bool UsbTransport::isConnected() {
  return s_usbMounted;
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
