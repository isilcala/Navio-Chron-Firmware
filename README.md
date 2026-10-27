# Navio-Chron-Firmware

Firmware for the [Navio Chron](https://github.com/Cityforest2000/Navio-Chron) open-source
video-editing keypad (hardware by Cityforest2000; PCB V1.0, two boards, ESP32-S3 SuperMini).
New codebase written from scratch — see `docs/hardware/HARDWARE_NOTES.md` for the verified
pin map and power architecture.

## Status — Phase 1 & 1b complete

- [x] Hardware bring-up layer: 4x5 matrix (16 switches), 3 encoders, WS2812 chain (15 px),
      battery sensing
- [x] USB HID (independent keyboard + consumer control + mouse + vendor interfaces),
      Adafruit_TinyUSB on core 3.12, driverless on Windows/macOS
- [x] **BLE HID** (NimBLE-Arduino): pairing on Windows/Android, auto-reconnect,
      USB/BLE auto-selection (USB host wins when enumerated)
- [x] Compile-time presets, cycled with the side micro-switch, persisted across reboots
- [x] Side-key gestures: tap = cycle preset / release after 5-10s = BLE pairing /
      10s hold = reflash without clearing bonds
- [x] No-unplug reflashing (side key or BOOT long-press → download mode, double-blink confirm)
- [x] Mouse report over BLE (wheel + combos)
- [x] **Production presets: JianYing (CapCut) and DaVinci Resolve on Windows — verified over USB & BLE**
- [ ] More presets: Premiere, macOS variants
- [ ] Sleep/wake (after battery is connected); large-knob B-phase rework pending
- [ ] Phase 2: PC-side configuration tool (NVS live presets)

## Build & flash

1. [VS Code + PlatformIO](https://platformio.org/) (or `pio` CLI), env `navio_chron`
2. Hold the **side key for 10s** (or module BOOT for 3s; LED turns purple) → upload.
   Holding the side key while powering on also enters download mode
3. Fallback: hold BOOT, plug USB, release, upload. If the board stays in download mode
   after flashing, tap RST once

Preset mappings live in `src/mapping/Presets.cpp` (Phase 1: edit + reflash).
Diagnostic builds on core 3.12: `ble_diag` (live BLE logging over USB-JTAG serial),
`debug_boot` / `led_beacon`.

## Layout

```
include/          pin map & tunables (cross-checked against schematics)
src/input/        matrix scanner, encoder decoder → logical events
src/action/       action model (key chord / consumer / wheel)
src/mapping/      preset data
src/hid/          ITransport + Adafruit_TinyUSB independent HID + NimBLE 2.5 BLE
src/proto/        independent vendor HID + configuration frame protocol
src/led/          WS2812 status & key lighting (Adafruit_NeoPixel on core 3.x)
src/power/        battery estimation
tools/            PlatformIO build scripts (USB include paths)
docs/hardware/    schematics + hardware notes + photos
reference/        upstream firmware (read-only, not part of the build; gitignored)
```

## Credits & license

- Hardware: [Cityforest2000](https://github.com/Cityforest2000/Navio-Chron)
  ([oshwhub project](https://oshwhub.com/cityforest/)) — upstream repo has no license file yet
- HID report descriptor and BLE details cross-checked against
  [HijelHID_BLEKeyboard](https://github.com/HijelHub/HijelHID_BLEKeyboard) (Apache-2.0)
- This firmware: license TBD before public release
