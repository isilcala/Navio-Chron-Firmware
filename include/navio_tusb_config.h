#pragma once

#include "arduino/ports/esp32/tusb_config_esp32.h"

#undef CONFIG_TINYUSB_HID_ENABLED
#define CONFIG_TINYUSB_HID_ENABLED 4
#undef CFG_TUD_HID
#define CFG_TUD_HID 4
