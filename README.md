# Navio-Chron-Firmware

Independent, from-scratch firmware for the [Navio Chron](https://github.com/Cityforest2000/Navio-Chron)
open-source DIY video-editing keypad (PCB V1.0, ESP32-S3 SuperMini).

> **Work in progress.** Core input, presets, USB/BLE HID, OTA, Web flashing and the
> browser-based preset editor are working; power management and app-specific preset tuning remain.

## Current status

- [x] Matrix keys, 3 encoders, WS2812 lighting and battery sensing
- [x] USB HID keyboard, mouse, consumer control and vendor interface
- [x] BLE HID with pairing, reconnect and USB/BLE auto-selection
- [x] JianYing and DaVinci Resolve presets for Windows, verified over USB and BLE
- [x] Dynamic presets in NVS and Navio Config Protocol v2
- [x] Dual-slot USB OTA with SHA-256, rollback and local self-confirm
- [x] Unified Web flasher: OTA, demo migration and BOOT/ROM recovery,
      [deployed and verified online](https://isilcala.github.io/Navio-Chron-Firmware/)
- [x] Browser preset editor with local library and full device management, verified on hardware;
      firmware version label and update notices use HELLO and the deployed release manifest
- [x] Official preset templates as per-preset JSON data files with a generated index and CI validation
- [x] Official template library at 28 presets: twelve Win/Mac app families, Final Cut Pro (Mac), Procreate (iPad), F13 Macro and Test; brand-consistent accents (on-app tuning pending)
- [x] Productized editor workflow: one explicit edit session, source copies, single-preset install/update and disconnect recovery
- [x] Cross-page, accessibility, responsive, online and hardware WebHID UX regression
- [x] Animated Web RGB previews and graphical effect cards for nine active effects plus an off mode; no hardware preview protocol
- [ ] Hardware and power validation for default-reactive behavior and all ten lighting modes (implemented in 0.5.26)
- [ ] Sleep/wake and battery-power validation

See `docs/PROJECT.md` for the roadmap and `docs/DECISIONS.md` for technical decisions.

## Flash online

Open **https://isilcala.github.io/Navio-Chron-Firmware/** to edit presets in desktop Chrome or Edge.
Firmware updates are available at **https://isilcala.github.io/Navio-Chron-Firmware/firmware/**.
GitHub Actions builds the firmware, manifest and four ROM images and publishes them with
`.github/workflows/pages.yml` on `main` and manual runs.

## Build locally

Use VS Code + PlatformIO (or the `pio` CLI), environment `navio_chron`.
The firmware and release-manifest version is maintained in `src/Version.h`; changing it only
recompiles `ConfigProto.cpp` and relinks instead of rebuilding all dependencies.

```bash
pio run
pio run -t upload
```

Hold the side key for 10s (or module BOOT for 3s) to enter download mode.
Fallback: hold BOOT, plug USB, release, then upload. Tap RST or reconnect power if the board
stays in download mode after flashing.

Upgrade an OTA-capable device over Vendor HID:

```bash
python tools/ota_upload.py .pio/build/navio_chron/firmware.bin
```

For local Web flashing probes:

```bash
python tools/make_release.py
python -m http.server 8000
# http://localhost:8000/tools/probe/webunified_probe.html
```

For the isolated UX/UI prototype (mock data only, no device access):

```bash
python -m http.server 8000
# http://localhost:8000/prototype/
```

## Layout

```
include/          pin map and tunables
editor/           SVG preset editor, local library, 150B codec and Node tests
prototype/        isolated interactive UX/UI prototype with mock data
src/              input, actions, mappings, HID, protocol, OTA, LEDs and power
tools/            build/release tools and hidapi/WebHID/Web Serial probes
docs/             protocol, decisions and hardware notes
.github/workflows/  GitHub Pages build and deployment
release/          generated release images and manifest (gitignored)
reference/        upstream reference (read-only, gitignored)
```

## Credits

1. **[Navio Chron — Cityforest2000](https://github.com/Cityforest2000/Navio-Chron)**:
   the open-source DIY keyboard and original hardware project this firmware is built for.
2. [HijelHID_BLEKeyboard](https://github.com/HijelHub/HijelHID_BLEKeyboard) (Apache-2.0):
   HID report descriptor and BLE implementation reference.
3. Adafruit TinyUSB, NimBLE-Arduino, Adafruit NeoPixel, esptool-js and pako,
   used under their respective licenses.

## License

This repository is WIP and currently has **no `LICENSE` file**; the project license is TBD.
The upstream Navio-Chron repository also has no license file. No additional rights are implied.
Third-party code and test assets, including the FastLED demo dump, retain their original terms.
