#include "mapping/Keymap.h"

namespace navio {

// ---------------------------------------------------------------------------
// 预设内容。第一期：改预设 = 改这里 + 重新编译烧录（第二期做电脑端配置）。
// 按键动作按实测物理位（docs/hardware/HARDWARE_NOTES.md 回填表）填写：
//   顶部三长键 K1/K2/K3；中央旋钮右侧 K4/K5；右下 K7(左)/K6(右)；
//   箭头簇 上K8 下K11 左K10 右K12；滚轮左侧偏下 K9；侧键=全局手势不映射。
// ---------------------------------------------------------------------------

// 预设 0：剪映 JianYing（Windows）——上游 layer0 底稿忠实翻译，实测后微调
static const Preset kPresetJianYing = {
    "JianYing",
    {0, 170, 170},  // 剪映青
    {
        /* K1  顶部左   */ actKey(MOD_NONE, HID_Q),             // 左剪裁
        /* K2  顶部中   */ actKey(MOD_CTRL, HID_B),             // 切分
        /* K3  顶部右   */ actKey(MOD_NONE, HID_W),             // 右剪裁
        /* K4  旋钮右上 */ actKey(MOD_CTRL, HID_Z),             // 撤销
        /* K5  旋钮右下 */ actKey(MOD_CTRL, HID_Y),             // 重做
        /* K6  右下右   */ actKey(MOD_NONE, HID_SPACE),         // 播放/暂停
        /* K7  右下左   */ actKey(MOD_NONE, HID_BACKSPACE),     // 删除
        /* K8  箭头上   */ actKey(MOD_NONE, HID_UP),
        /* K9  滚轮左下 */ actKey(MOD_ALT, 0),                  // Alt 按住（上游用法）
        /* K10 箭头左   */ actKey(MOD_NONE, HID_LEFT),
        /* K11 箭头下   */ actKey(MOD_NONE, HID_DOWN),
        /* K12 箭头右   */ actKey(MOD_NONE, HID_RIGHT),
        /* EncCenterPress */ actKey(MOD_NONE, HID_V),           // 'v'（上游）
        /* EncLargePress  */ actKey(MOD_NONE, HID_SPACE),       // 播放/暂停
        /* WheelPress     */ actKey(MOD_NONE, HID_0),           // '0'（上游）
        /* SideKey        */ actNone(),  // 固定用作预设切换（main 处理）
    },
    {
        /* Center 中央旋钮 */ {actKey(MOD_NONE, HID_RIGHT), actKey(MOD_NONE, HID_LEFT)},  // 帧进退
        /* Large 大旋钮    */ {actWheel(1, MOD_ALT), actWheel(-1, MOD_ALT)},   // 时间轴缩放
        /* Wheel 滚轮      */ {actWheel(1, MOD_CTRL), actWheel(-1, MOD_CTRL)}, // 画面缩放
    },
};

// 预设 1：冒烟测试——按键出数字/符号，编码器出音量/方向/滚轮，方便逐路验证
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
        /* WheelPress     */ actKey(MOD_NONE, HID_ESC),
        /* SideKey        */ actNone(),  // 固定用作预设切换（main 处理）
    },
    {
        /* Center 中央旋钮 */ {actConsumer(CONSUMER_VOL_UP), actConsumer(CONSUMER_VOL_DOWN)},
        /* Large 大旋钮    */ {actKey(MOD_NONE, HID_RIGHT), actKey(MOD_NONE, HID_LEFT)},
        /* Wheel 滚轮      */ {actWheel(1), actWheel(-1)},
    },
};

// 预设 2：通用 F13-F24 宏——按键映射到 F13..F24，在剪辑软件里自定义快捷键即可用。
// TODO(Elvin): 按 Premiere / 剪映 / Resolve / Procreate 的实际习惯细分，
//              并拆分 Win(Ctrl) / Mac(Cmd) 版本；编码器先沿用测试配置。
// 剪映预设参考（上游 layer0 原始映射，物理位见 docs/hardware/HARDWARE_NOTES.md）：
//   K1=q K2=Ctrl+B K3=w K4=Ctrl+Z K5=Ctrl+Y K6=Space K7=Backspace
//   K8=↑ K9=Alt K10=← K11=↓ K12=→ 大旋钮按压=Space 中央旋钮按压=v
//   中央旋钮=←/→ 大旋钮=Alt+滚轮(时间轴) 滚轮=Ctrl+滚轮(缩放)
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
        /* WheelPress     */ actKey(MOD_CTRL, HID_Z),  // 撤销（Win）
        /* SideKey        */ actNone(),
    },
    {
        /* Center */ {actConsumer(CONSUMER_VOL_UP), actConsumer(CONSUMER_VOL_DOWN)},
        /* Large  */ {actKey(MOD_CTRL, HID_EQUAL), actKey(MOD_CTRL, HID_MINUS)},  // 缩放
        /* Wheel  */ {actWheel(1), actWheel(-1)},
    },
};

// 命名空间作用域的 const 默认内部链接，定义处加 extern 才能被其他编译单元引用
extern const Preset kPresets[] = {kPresetJianYing, kPresetTest, kPresetF13};
extern const size_t kPresetCount = sizeof(kPresets) / sizeof(kPresets[0]);

}  // namespace navio
