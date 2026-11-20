#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

extern uint32_t fakeMillis;

inline uint32_t millis() { return fakeMillis; }
inline uint32_t esp_random() { return 0x5A; }
