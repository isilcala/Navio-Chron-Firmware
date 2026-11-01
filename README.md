# Navio-Chron-Firmware

Independent, from-scratch firmware for the [Navio Chron](https://github.com/Cityforest2000/Navio-Chron)
open-source DIY video-editing keypad (PCB V1.0, ESP32-S3 SuperMini).

> **Work in progress.** Core input, presets, USB/BLE HID, OTA and Web flashing are working;
> the browser-based preset editor and additional presets are still being built.

## Current status

- [x] Matrix keys, 3 encoders, WS2812 lighting and battery sensing
- [x] USB HID keyboard, mouse, consumer control and vendor interface
- [x] BLE HID with pairing, reconnect and USB/BLE auto-selection
- [x] JianYing (CapCut) and DaVinci Resolve presets for Windows, verified over USB and BLE
- [x] Dynamic presets in NVS and Navio Config Protocol v2
- [x] Dual-slot USB OTA with SHA-256, rollback and local self-confirm
- [x] Unified Web flasher: OTA, demo migration and BOOT/ROM recovery,
      [deployed and verified online](https://isilcala.github.io/Navio-Chron-Firmware/)
- [ ] Browser preset editor (static SVG prototype implemented; device connection pending)
- [ ] Premiere and macOS preset variants
- [ ] Sleep/wake and battery-power validation

See `docs/PROJECT.md` for the roadmap and `docs/DECISIONS.md` for technical decisions.

## Flash online

Open **https://isilcala.github.io/Navio-Chron-Firmware/** in desktop Chrome or Edge.
GitHub Actions builds the firmware, manifest and four ROM images and publishes them with
`.github/workflows/pages.yml` on `main` and manual runs.

## Build locally

Use VS Code + PlatformIO (or the `pio` CLI), environment `navio_chron`:

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

## Layout

```
include/          pin map and tunables
editor/           SVG preset editor, local library, 150B codec and Node tests
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
