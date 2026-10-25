# Navio-Chron-Firmware

Firmware for the [Navio Chron](https://github.com/Cityforest2000/Navio-Chron) open-source
video-editing keypad (hardware by Cityforest2000; PCB V1.0, two boards, ESP32-S3 SuperMini).
New codebase written from scratch — see `docs/hardware/HARDWARE_NOTES.md` for the verified
pin map and power architecture.

## Status — Phase 1 (in progress)

- [x] Hardware bring-up layer: 4x5 matrix (16 switches), 3 encoders, WS2812 chain (15 px),
      battery sensing
- [x] USB HID (keyboard + consumer control + mouse wheel), driverless on Windows/macOS
- [x] Compile-time presets, cycled with the side micro-switch, persisted across reboots
- [ ] BLE transport (`ITransport`) with USB/BLE auto-selection
- [ ] Real presets for Premiere / DaVinci Resolve / JianYing (剪映) / Procreate, Win + macOS
- [ ] Phase 2: PC-side configuration tool (NVS live presets)

## Build & flash

1. [VS Code + PlatformIO](https://platformio.org/) (or `pio` CLI)
2. Open this folder, build env `navio_chron`, upload over USB
3. If the board doesn't enter download mode automatically: hold **BOOT**, tap **RST**,
   release **BOOT**, then upload
4. Serial console over USB CDC at 115200 (debug log)

Preset mappings live in `src/mapping/Presets.cpp` (Phase 1: edit + reflash).

## Layout

```
include/          pin map & tunables (cross-checked against schematics)
src/input/        matrix scanner, encoder decoder → logical events
src/action/       action model (key chord / consumer / wheel)
src/mapping/      preset data
src/hid/          ITransport + USB implementation (BLE TODO)
src/led/          WS2812 status & key lighting
src/power/        battery estimation
docs/hardware/    schematics + hardware notes
reference/        upstream firmware (read-only, not part of the build; gitignored)
```

## Credits & license

- Hardware: [Cityforest2000](https://github.com/Cityforest2000/Navio-Chron)
  ([oshwhub project](https://oshwhub.com/cityforest/)) — upstream repo has no license file yet
- This firmware: license TBD before public release
