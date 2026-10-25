#include "mapping/Keymap.h"

namespace navio {

// ---------------------------------------------------------------------------
// 预设内容。第一期：改预设 = 改这里 + 重新编译烧录（第二期做电脑端配置）。
// 按键动作请按 K1..K12 / EncCenterPress / EncLargePress / Tact 的物理位
// （见 input/InputEvents.h 注释）填写。
// ---------------------------------------------------------------------------

// 预设 0：冒烟测试——按键出数字/符号，编码器出音量/方向/滚轮，方便逐路验证
static const Preset kPresetTest = {
    "Test",
    {0, 0, 200},  // 蓝
    {
        /* K1  */ actKey(MOD_NONE, HID_1),
        /* K2  */ actKey(MOD_NONE, HID_2),
        /* K3  */ actKey(MOD_NONE, HID_3),
        /* K4  */ actKey(MOD_NONE, HID_4),
        /* K5  */ actKey(MOD_NONE, HID_5),
        /* K6  */ actKey(MOD_NONE, HID_6),
        /* K7  */ actKey(MOD_NONE, HID_7),
        /* K8  */ actKey(MOD_NONE, HID_8),
        /* K9  */ actKey(MOD_NONE, HID_9),
        /* K10 */ actKey(MOD_NONE, HID_0),
        /* K11 */ actKey(MOD_NONE, HID_MINUS),
        /* K12 */ actKey(MOD_NONE, HID_EQUAL),
        /* EncCenterPress */ actConsumer(CONSUMER_MUTE),
        /* EncLargePress  */ actKey(MOD_NONE, HID_ENTER),
        /* SideKey        */ actNone(),  // 固定用作预设切换（main 处理）
        /* Tact           */ actKey(MOD_NONE, HID_ESC),
    },
    {
        /* Center 中央旋钮 */ {actConsumer(CONSUMER_VOL_UP), actConsumer(CONSUMER_VOL_DOWN)},
        /* Large 大旋钮    */ {actKey(MOD_NONE, HID_RIGHT), actKey(MOD_NONE, HID_LEFT)},
        /* Wheel 滚轮      */ {actWheel(1), actWheel(-1)},
    },
};

// 预设 1：通用 F13-F24 宏——按键映射到 F13..F24，在剪辑软件里自定义快捷键即可用。
// TODO(Elvin): 按 Premiere / 剪映 / Resolve / Procreate 的实际习惯细分，
//              并拆分 Win(Ctrl) / Mac(Cmd) 版本；编码器先沿用测试配置。
static const Preset kPresetF13 = {
    "F13 Macro",
    {160, 0, 200},  // 紫
    {
        /* K1  */ actKey(MOD_NONE, HID_F13),
        /* K2  */ actKey(MOD_NONE, HID_F14),
        /* K3  */ actKey(MOD_NONE, HID_F15),
        /* K4  */ actKey(MOD_NONE, HID_F16),
        /* K5  */ actKey(MOD_NONE, HID_F17),
        /* K6  */ actKey(MOD_NONE, HID_F18),
        /* K7  */ actKey(MOD_NONE, HID_F19),
        /* K8  */ actKey(MOD_NONE, HID_F20),
        /* K9  */ actKey(MOD_NONE, HID_F21),
        /* K10 */ actKey(MOD_NONE, HID_F22),
        /* K11 */ actKey(MOD_NONE, HID_F23),
        /* K12 */ actKey(MOD_NONE, HID_F24),
        /* EncCenterPress */ actConsumer(CONSUMER_PLAY_PAUSE),
        /* EncLargePress  */ actKey(MOD_NONE, HID_SPACE),
        /* SideKey        */ actNone(),
        /* Tact           */ actKey(MOD_CTRL, HID_Z),  // 撤销（Win）
    },
    {
        /* Center */ {actConsumer(CONSUMER_VOL_UP), actConsumer(CONSUMER_VOL_DOWN)},
        /* Large  */ {actKey(MOD_CTRL, HID_EQUAL), actKey(MOD_CTRL, HID_MINUS)},  // 缩放
        /* Wheel  */ {actWheel(1), actWheel(-1)},
    },
};

// 命名空间作用域的 const 默认内部链接，定义处加 extern 才能被其他编译单元引用
extern const Preset kPresets[] = {kPresetTest, kPresetF13};
extern const size_t kPresetCount = sizeof(kPresets) / sizeof(kPresets[0]);

}  // namespace navio
