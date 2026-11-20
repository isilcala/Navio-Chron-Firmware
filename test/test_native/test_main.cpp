#include <Arduino.h>
#include <unity.h>

#include <array>
#include <vector>

#include "ByteOrder.h"
#include "led/LedController.h"
#include "mapping/PresetRecord.h"
#include "proto/Crc.h"

uint32_t fakeMillis = 0;
std::vector<uint32_t> fakeNeoPixelPixels;
std::vector<std::vector<uint32_t>> fakeNeoPixelFrames;

namespace {

using namespace navio;

constexpr uint8_t kAccent[3] = {100, 50, 25};

InstalledPreset validPreset() {
  InstalledPreset preset = {};
  preset.id = 42;
  strcpy(preset.name, "剪映");
  preset.preset.name = preset.name;
  preset.preset.accent[0] = 12;
  preset.preset.accent[1] = 34;
  preset.preset.accent[2] = 56;
  preset.preset.rgbMode = 9;
  preset.platform = 2;
  preset.preset.btn[0] = actKey(MOD_CTRL | MOD_SHIFT, HID_C);
  preset.preset.btn[1] = actConsumer(CONSUMER_PLAY_PAUSE);
  preset.preset.enc[2][0] = actWheel(3, MOD_CTRL);
  preset.preset.enc[2][1] = actWheel(-3, MOD_CTRL);
  return preset;
}

void tickAt(LedController& leds, uint32_t at) {
  fakeMillis = at;
  leds.tick();
}

const std::vector<uint32_t>& lastFrame() {
  TEST_ASSERT_FALSE(fakeNeoPixelFrames.empty());
  return fakeNeoPixelFrames.back();
}

void assertKeysOff(int except = -1) {
  const auto& frame = lastFrame();
  for (int key = 0; key < 12; ++key) {
    if (key == except) {
      TEST_ASSERT_NOT_EQUAL(0, frame[LED_KEY_FIRST + key]);
    } else {
      TEST_ASSERT_EQUAL_HEX32(0, frame[LED_KEY_FIRST + key]);
    }
  }
}

void assertAllKeysOn() {
  const auto& frame = lastFrame();
  for (int key = 0; key < 12; ++key) {
    TEST_ASSERT_NOT_EQUAL(0, frame[LED_KEY_FIRST + key]);
  }
}

void testPresetRecordRoundTrip() {
  InstalledPreset source = validPreset();
  std::array<uint8_t, PRESET_RECORD_SIZE> record = {};
  encodePresetRecord(source, record.data());

  InstalledPreset decoded = {};
  TEST_ASSERT_EQUAL(PresetRecordResult::Ok,
                    decodePresetRecord(record.data(), record.size(), decoded));
  TEST_ASSERT_EQUAL_UINT8(42, decoded.id);
  TEST_ASSERT_EQUAL_STRING("剪映", decoded.name);
  TEST_ASSERT_EQUAL_PTR(decoded.name, decoded.preset.name);
  TEST_ASSERT_EQUAL_UINT8(9, decoded.preset.rgbMode);
  TEST_ASSERT_EQUAL_UINT8(2, decoded.platform);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(source.preset.accent, decoded.preset.accent, 3);
  TEST_ASSERT_EQUAL_UINT8(MOD_CTRL | MOD_SHIFT, decoded.preset.btn[0].mods);
  TEST_ASSERT_EQUAL_UINT16(HID_C, decoded.preset.btn[0].code);
  TEST_ASSERT_EQUAL_UINT16(CONSUMER_PLAY_PAUSE, decoded.preset.btn[1].code);
  TEST_ASSERT_EQUAL_INT8(3, decoded.preset.enc[2][0].wheelDy);
  TEST_ASSERT_EQUAL_UINT8(MOD_CTRL, decoded.preset.enc[2][0].mods);
  TEST_ASSERT_EQUAL_INT8(-3, decoded.preset.enc[2][1].wheelDy);

  std::array<uint8_t, PRESET_RECORD_SIZE> reencoded = {};
  encodePresetRecord(decoded, reencoded.data());
  TEST_ASSERT_EQUAL_UINT8_ARRAY(record.data(), reencoded.data(), record.size());
}

void testPresetRecordRejectsMalformedRecords() {
  InstalledPreset source = validPreset();
  std::array<uint8_t, PRESET_RECORD_SIZE> valid = {};
  encodePresetRecord(source, valid.data());
  InstalledPreset decoded = {};

  TEST_ASSERT_EQUAL(PresetRecordResult::Invalid,
                    decodePresetRecord(valid.data(), valid.size() - 1, decoded));

  auto record = valid;
  record[2] = 2;
  TEST_ASSERT_EQUAL(PresetRecordResult::UnsupportedVersion,
                    decodePresetRecord(record.data(), record.size(), decoded));

  record = valid;
  record[12] = 1;
  writeLe16(record.data() + 148, crc16(record.data(), 148));
  TEST_ASSERT_EQUAL(PresetRecordResult::Invalid,
                    decodePresetRecord(record.data(), record.size(), decoded));

  record = valid;
  record[148] ^= 0x01;
  TEST_ASSERT_EQUAL(PresetRecordResult::Invalid,
                    decodePresetRecord(record.data(), record.size(), decoded));

  source.preset.btn[0] = actWheel(1);
  encodePresetRecord(source, record.data());
  TEST_ASSERT_EQUAL(PresetRecordResult::Invalid,
                    decodePresetRecord(record.data(), record.size(), decoded));
}

void testPresetWaitsForTickBeforeShowing() {
  fakeMillis = 100;
  LedController leds;
  leds.begin();
  leds.showPreset(kAccent, 7);
  TEST_ASSERT_TRUE(fakeNeoPixelFrames.empty());

  leds.tick();
  TEST_ASSERT_EQUAL_UINT32(1, fakeNeoPixelFrames.size());
  TEST_ASSERT_EQUAL_UINT32(LED_COUNT, lastFrame().size());
  TEST_ASSERT_NOT_EQUAL(0, lastFrame()[0]);
}

void testChannelFeedbackOwnsFramesAndRestoresPreset() {
  fakeMillis = 100;
  LedController leds;
  leds.begin();
  leds.showPreset(kAccent, 3);
  leds.showChannelFeedback(1);
  leds.tick();
  assertKeysOff(1);

  tickAt(leds, 220);
  assertKeysOff();
  tickAt(leds, 340);
  assertKeysOff(1);
  tickAt(leds, 460);
  assertKeysOff();
  tickAt(leds, 580);
  assertKeysOff(1);
  tickAt(leds, 700);
  assertKeysOff();
  tickAt(leds, 820);
  assertAllKeysOn();
  TEST_ASSERT_EQUAL_UINT32(7, fakeNeoPixelFrames.size());
}

void testIdlePreservesStatusAndShutdownFlushesImmediately() {
  fakeMillis = 100;
  LedController leds;
  leds.begin();
  leds.showPreset(kAccent, 3);
  leds.setModeColor(10, 20, 30);
  leds.tick();
  const uint32_t presetColor = lastFrame()[0];
  const uint32_t modeColor = lastFrame()[1];

  leds.setBatteryLow(true);
  tickAt(leds, 1120);
  const uint32_t batteryColor = lastFrame()[2];
  TEST_ASSERT_NOT_EQUAL(0, batteryColor);

  leds.setIdle(true);
  const size_t idleFrameCount = fakeNeoPixelFrames.size();
  tickAt(leds, 1140);
  TEST_ASSERT_EQUAL_UINT32(idleFrameCount + 1, fakeNeoPixelFrames.size());
  assertKeysOff();
  TEST_ASSERT_EQUAL_HEX32(presetColor, lastFrame()[0]);
  TEST_ASSERT_EQUAL_HEX32(modeColor, lastFrame()[1]);
  TEST_ASSERT_EQUAL_HEX32(batteryColor, lastFrame()[2]);

  leds.setIdle(false);
  tickAt(leds, 1160);
  assertAllKeysOn();

  const size_t beforeShutdown = fakeNeoPixelFrames.size();
  leds.shutdown();
  TEST_ASSERT_EQUAL_UINT32(beforeShutdown + 1, fakeNeoPixelFrames.size());
  for (uint32_t color : lastFrame()) TEST_ASSERT_EQUAL_HEX32(0, color);
}

}  // namespace

void setUp() {
  fakeMillis = 0;
  fakeNeoPixelPixels.clear();
  fakeNeoPixelFrames.clear();
}

void tearDown() {}

int main() {
  UNITY_BEGIN();
  RUN_TEST(testPresetRecordRoundTrip);
  RUN_TEST(testPresetRecordRejectsMalformedRecords);
  RUN_TEST(testPresetWaitsForTickBeforeShowing);
  RUN_TEST(testChannelFeedbackOwnsFramesAndRestoresPreset);
  RUN_TEST(testIdlePreservesStatusAndShutdownFlushesImmediately);
  return UNITY_END();
}
