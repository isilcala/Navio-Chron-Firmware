# AGENTS.md — AI 协作入口

给 AI 编码代理（Claude Code 等）的项目速览。先读 `docs/PROJECT.md`（需求）和
`docs/DECISIONS.md`（决策与理由），动硬件相关代码前读 `docs/hardware/HARDWARE_NOTES.md`。

## 这是什么

Navio Chron 视频剪辑小键盘的配套固件（ESP32-S3 SuperMini，双板硬件，16 路输入，
3 编码器，15 颗 WS2812）。全新实现，不依赖上游代码。

## 构建与烧录

```bash
# PlatformIO（VS Code 扩展或 CLI），环境名 navio_chron
pio run                 # 编译
pio run -t upload       # 烧录：板上固件长按 BOOT 键或侧键 3 秒（RGB 变紫）进下载模式后直接 upload；
                        # 插电时按住侧键同样进入（组装后 BOOT 键难按）
pio device monitor      # 调试串口 115200（主固件 CDC 关闭，日志用 debug_boot 环境或 RGB 信标）
# 兜底（固件挂死/首次）：拔线 → 按住 BOOT → 插线 → 1 秒后松开 → upload
# 烧完偶发停在下载模式（esptool 硬复位不生效）：点按 RST 即可
```

- 目标：`board = esp32-s3-devkitc-1` + 覆盖（4MB QIO flash + 2MB PSRAM，qio_qspi）。
- `build_unflags = -std=gnu++11` 不能删（见 DECISIONS.md D1）。
- 改引脚/参数 → `include/Pins.h`、`include/Config.h`；改预设 → `src/mapping/Presets.cpp`。

## 代码地图与核心约定

```
include/        引脚表(Pins.h)、可调参数(Config.h) —— 与硬件笔记一一对应
src/input/      矩阵扫描 + 编码器解码 → BtnEvent/EncoderEvent（逻辑输入枚举 Btn/Enc）
src/action/     Action 模型：KeyChord / Consumer / Wheel（可带修饰键）
src/mapping/    Preset 数据结构 + 预设内容（第一期编译期固化）
src/hid/        ITransport 接口 + USB 实现；BLE 实现同一接口即可接入
src/led/        WS2812：LED0 预设色 / LED1 模式 / LED2 电量 / LED3-14 按键
src/power/      电池电压估算（GPIO3 ÷2 分压）
```

- **键码一律用 HID Usage ID**（`src/hid/HidUsage.h`），全链路不做 ASCII 转换。
- **Btn 枚举即物理位**：注释里的 R2C3 等对应矩阵 ROW/COL，与硬件笔记矩阵表一致；
  勿按枚举顺序臆测物理布局。
- **SideKey（SW11）固定为预设切换**，不走预设映射；其余 15 路输入全部可映射。
- 语言约定：交流与文档中文；标识符、代码、commit message 英文。

## 当前状态与下一步

Phase 1（USB 全输入 + 编译期预设）代码就绪待上机验证；下一步 Phase 1b：BLE。
具体见 docs/PROJECT.md 分期表。上游参考在 `reference/`（gitignore，只读，无 LICENSE，
只可参考不可复制）。
