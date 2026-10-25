#pragma once
// USB HID Usage ID 常用子集。全部动作键码统一使用 HID Usage ID，
// USB 传输直接透传，将来 BLE 传输同样透传。
#include <Arduino.h>

namespace navio {

// 修饰键位掩码（报告字节 bit0-7）
constexpr uint8_t MOD_NONE = 0;
constexpr uint8_t MOD_CTRL = 0x01;
constexpr uint8_t MOD_SHIFT = 0x02;
constexpr uint8_t MOD_ALT = 0x04;    // Option on macOS
constexpr uint8_t MOD_GUI = 0x08;    // Win / Cmd
constexpr uint8_t MOD_RCTRL = 0x10;
constexpr uint8_t MOD_RSHIFT = 0x20;
constexpr uint8_t MOD_RALT = 0x40;   // AltGr
constexpr uint8_t MOD_RGUI = 0x80;

// 键盘 Usage ID（十进制含义为 HID usage tables 标准）
constexpr uint16_t HID_A = 0x04, HID_B = 0x05, HID_C = 0x06, HID_D = 0x07, HID_E = 0x08,
    HID_F = 0x09, HID_G = 0x0A, HID_H = 0x0B, HID_I = 0x0C, HID_J = 0x0D, HID_K = 0x0E,
    HID_L = 0x0F, HID_M = 0x10, HID_N = 0x11, HID_O = 0x12, HID_P = 0x13, HID_Q = 0x14,
    HID_R = 0x15, HID_S = 0x16, HID_T = 0x17, HID_U = 0x18, HID_V = 0x19, HID_W = 0x1A,
    HID_X = 0x1B, HID_Y = 0x1C, HID_Z = 0x1D;
constexpr uint16_t HID_1 = 0x1E, HID_2 = 0x1F, HID_3 = 0x20, HID_4 = 0x21, HID_5 = 0x22,
    HID_6 = 0x23, HID_7 = 0x24, HID_8 = 0x25, HID_9 = 0x26, HID_0 = 0x27;
constexpr uint16_t HID_ENTER = 0x28, HID_ESC = 0x29, HID_BACKSPACE = 0x2A, HID_TAB = 0x2B,
    HID_SPACE = 0x2C, HID_MINUS = 0x2D, HID_EQUAL = 0x2E, HID_LBRACKET = 0x2F,
    HID_RBRACKET = 0x30, HID_BACKSLASH = 0x31, HID_SEMICOLON = 0x33, HID_QUOTE = 0x34,
    HID_GRAVE = 0x35, HID_COMMA = 0x36, HID_PERIOD = 0x37, HID_SLASH = 0x38,
    HID_CAPSLOCK = 0x39;
constexpr uint16_t HID_F1 = 0x3A, HID_F2 = 0x3B, HID_F3 = 0x3C, HID_F4 = 0x3D, HID_F5 = 0x3E,
    HID_F6 = 0x3F, HID_F7 = 0x40, HID_F8 = 0x41, HID_F9 = 0x42, HID_F10 = 0x43,
    HID_F11 = 0x44, HID_F12 = 0x45;
// F13-F24：键盘上不存在，编辑软件里适合当专用快捷键绑定
constexpr uint16_t HID_F13 = 0x68, HID_F14 = 0x69, HID_F15 = 0x6A, HID_F16 = 0x6B,
    HID_F17 = 0x6C, HID_F18 = 0x6D, HID_F19 = 0x6E, HID_F20 = 0x6F, HID_F21 = 0x70,
    HID_F22 = 0x71, HID_F23 = 0x72, HID_F24 = 0x73;
constexpr uint16_t HID_INSERT = 0x49, HID_HOME = 0x4A, HID_PAGEUP = 0x4B, HID_DELETE = 0x4C,
    HID_END = 0x4D, HID_PAGEDOWN = 0x4E, HID_RIGHT = 0x4F, HID_LEFT = 0x50, HID_DOWN = 0x51,
    HID_UP = 0x52;

// Consumer Control Usage ID（音量/播放等）
constexpr uint16_t CONSUMER_PLAY_PAUSE = 0x00CD, CONSUMER_STOP = 0x00B7,
    CONSUMER_NEXT = 0x00B5, CONSUMER_PREV = 0x00B6, CONSUMER_MUTE = 0x00E2,
    CONSUMER_VOL_UP = 0x00E9, CONSUMER_VOL_DOWN = 0x00EA;

}  // namespace navio
