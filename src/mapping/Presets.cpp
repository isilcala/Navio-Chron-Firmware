#include "mapping/Keymap.h"

#include "PresetManager.h"

namespace navio {

// 冒烟测试：按键出数字/符号，编码器出音量/方向/滚轮，方便逐路验证。
// 按键动作按实测物理位（docs/hardware/HARDWARE_NOTES.md 回填表）填写：
// 顶部三长键 K1/K2/K3；中央旋钮右侧 K4/K5；右下 K7(左)/K6(右)；
// 箭头簇 上K8 下K11 左K10 右K12；滚轮左侧偏下 K9；侧键=全局手势不映射。
static const Preset kPresetTest = {
    "Test",
    {255, 255, 255},
    7,
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
        /* WheelPress     */ actKey(MOD_NONE, HID_ESC),
        /* SideKey        */ actNone(),
    },
    {
        /* Center 中央旋钮 */ {actConsumer(CONSUMER_VOL_UP), actConsumer(CONSUMER_VOL_DOWN)},
        /* Large 大旋钮    */ {actKey(MOD_NONE, HID_RIGHT), actKey(MOD_NONE, HID_LEFT)},
        /* Wheel 滚轮      */ {actWheel(1), actWheel(-1)},
    },
};

// 命名空间作用域的 const 默认内部链接，定义处加 extern 才能被其他编译单元引用
extern const Preset kPresets[] = {kPresetTest};
extern const size_t kPresetCount = sizeof(kPresets) / sizeof(kPresets[0]);
static_assert(kPresetCount > 0 && kPresetCount <= PRESET_MAX_INSTALLED);

}  // namespace navio
