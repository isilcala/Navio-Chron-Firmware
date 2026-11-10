#pragma once

#include <Arduino.h>

namespace navio {

constexpr uint8_t BLE_BOND_MAX = 3;
constexpr uint8_t BLE_CHANNEL_UNASSIGNED = 0xFF;

struct BleBondAddress {
  uint8_t type = 0;
  uint8_t value[6] = {};
};

struct BleBondInfo {
  BleBondAddress address;
  uint32_t lastUsedSeq = 0;
  bool connected = false;
  uint8_t channel = BLE_CHANNEL_UNASSIGNED;
};

class IBleBondManager {
 public:
  virtual ~IBleBondManager() = default;
  virtual uint8_t bondCount() = 0;
  virtual bool readBond(uint8_t index, BleBondInfo& out) = 0;
  virtual bool deleteBond(const BleBondAddress& address) = 0;
  virtual bool clearBonds() = 0;
};

}  // namespace navio
