# AGENTS.md — AI 协作入口

给 AI 编码代理（Claude Code 等）的项目速览。先读 `docs/PROJECT.md`（需求）和
`docs/DECISIONS.md`（决策与理由），动硬件相关代码前读 `docs/hardware/HARDWARE_NOTES.md`。

## 这是什么

Navio Chron 视频剪辑小键盘的配套固件（ESP32-S3 SuperMini，双板硬件，16 路输入，
3 编码器，15 颗 WS2812）。全新实现，不依赖上游代码。**USB/BLE 双模 HID 已全链路实测**。

## 构建环境（platformio.ini，5 个）

| 环境 | 平台 | 用途 |
|---|---|---|
| `navio_chron`（默认） | core 3.12 + NimBLE 2.5.1 + Adafruit_TinyUSB 3.7.7 + Adafruit_NeoPixel | 正式固件：USB 优先自动选 BLE，无 CDC |
| `ble_test` | 同上 + FORCE_BLE + IGNORE_MATRIX | BLE 强制路径测试（未焊接阶段） |
| `ble_diag` | 同上 + USB 外设让给 JTAG 串口 | BLE 实时日志诊断（串口监视器） |
| `debug_boot` / `led_beacon` | 同一 core 3.12 基座 | 启动分步日志 / 板载 RGB 颜色信标 |

## 构建与烧录

```bash
pio run                 # 编译（默认环境 navio_chron）
pio run -t upload       # 烧录：板上固件长按侧键 10 秒或 BOOT 键 3 秒（RGB 变紫）进下载模式后直接 upload；
                        # 插电时按住侧键同样进入
pio device monitor      # 串口 115200（主固件 CDC 关闭 D9；日志用 ble_diag/debug_boot 环境）
# 兜底（固件挂死/首次/诊断固件）：拔线 → 按住 BOOT → 插线 → 松开 → upload
# 烧完偶发停在下载模式（esptool 硬复位不生效）：点按 RST；装配后 RST 摸不到则重新插拔
```

**烧录纪律（教训固化）**：烧任何非 navio_chron 环境（debug_boot/ble_diag/ble_test）后，
必须明确告知用户"当前板上固件 = X，不具备正式固件的 HID/手势功能"；诊断结束的默认动作
= 立即烧回 navio_chron。诊断固件没有侧键手势入口（只有 BOOT 插拔兜底）。

## 代码地图与核心约定

```
include/        引脚表(Pins.h)、参数(Config.h) —— 与硬件笔记一一对应
src/input/      矩阵扫描 + 编码器解码 → BtnEvent/EncoderEvent
src/action/     Action 模型：KeyChord / Consumer / Wheel（可带修饰键）
src/mapping/    Preset 数据 + 预设内容（Phase 1 编译期固化）
src/hid/        ITransport 接口 + Adafruit_TinyUSB 独立 HID + NimBLE 2.5 BLE
src/proto/      独立 Vendor HID（ID6 + 63B）+ 配置帧骨架；回调入队，主循环处理
src/led/        WS2812：LedController（统一 Adafruit_NeoPixel 后端）
src/power/      电池电压估算（GPIO3 ÷2 分压）
tools/          add_fs_include.py：pre: 阶段注入 FS / 项目 / Adafruit 头路径
```

- **键码一律用 HID Usage ID**（`src/hid/HidUsage.h`），全链路不做 ASCII 转换。
- **BLE 报告细节（D12）**：报告不带 Report ID 前缀；连接后首帧需 prime 空报告；
  pressChord 必须把键码写入 `kbKeys_[slot]`（缺此行 = 发送全零报告，历史最贵 bug）。
- **Btn 枚举即物理位**：注释里的 R2C3 对应硬件笔记矩阵表，勿按枚举顺序臆测布局。
- **SideKey（SW11）全局保留**：单击=切预设 / 长按 5s=BLE 配对（清绑定）/ 长按 10s=烧写。
- **未焊接阶段**：矩阵/编码器悬空有噪声事件，测试用 IGNORE_MATRIX 构建；
  板载 RGB(GPIO48) 是唯一可视调试手段（信标+测试键反馈）。
- 语言约定：交流与文档中文；标识符、代码、commit message 英文。

## 文档同步约定（每次 git commit 前自查）

改了下表左列的内容，必须同步检查右列文档（同一个 commit 内或紧随其后）：

| 你改了什么 | 必查文档 |
|---|---|
| 硬件引脚 / 新外设 / 新硬件事实 | `docs/hardware/HARDWARE_NOTES.md`（含 Pins.h 与它的一致性） |
| 技术选型、推翻或修订已有决策、新踩平台/库的坑 | `docs/DECISIONS.md`（新增 D 条目 / 修订 / 显式撤销——撤销要留痕，如 D11） |
| 阶段目标完成、范围变化、手势/交互语义变更 | `docs/PROJECT.md` 分期表 + `README.md` Status + 本文件"当前状态" |
| 构建环境（platformio.ini）、烧录流程、目录结构 | 本文件"构建环境/构建与烧录/代码地图" + `README.md` Build/Layout |
| 升级/降级依赖版本 | `docs/DECISIONS.md`（版本策略 D8：锁定已验证组合） |

原则：**文档陈述的状态永远不得超前于代码**（写"已完成"必须先实测）；
小 bug fix 不在表内、无需动文档。

## 当前状态与遗留

Phase 1 + 1b + 生产预设完成：**剪映 / Resolve（Win）USB/BLE 双模实战通过**。
2026-10-27 完成 core 3.x 单轨与 Adafruit_TinyUSB 四独立 HID 迁移（D16）：
hidapi / WebHID HELLO、GET_INFO、现有双模输入与五环境构建均通过。遗留（按优先级）：
1. 硬件：大旋钮 B 相（IO40/R2R 线路）断线补焊——已诊断（A 相正常、B 相恒高），补焊后免费复验
2. Phase 2 前置修复：输入动作快照、修饰键/Consumer 持有计数、BLE 断线键态、矩阵队列容量
3. Phase 2：完整分片协议、NVS 动态预设、电脑端配置工具
4. 预设扩展：Premiere / macOS 版本（Cmd=GUI 修饰）
5. 电池接入后：睡眠唤醒、电量灯实测、BLE 功耗策略
6. 已知问题：BOOT 长按 3s 进下载模式在 BLE 连接时偶发失效（待查，兜底=BOOT 插拔）

上游参考在 `reference/`（gitignore，只读，无 LICENSE，只可参考不可复制）。
