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
python tools/ota_upload.py .pio/build/navio_chron/firmware.bin  # 已支持 OTA 的固件：Vendor HID 应用升级
python tools/make_release.py # 构建后生成 release 四件套 + manifest
python -m http.server 8000   # 统一探针：http://localhost:8000/tools/probe/webunified_probe.html
# 兜底（固件挂死/首次/诊断固件）：拔线 → 按住 BOOT → 插线 → 松开 → upload
# 烧完偶发停在下载模式（esptool 硬复位不生效）：点按 RST；装配后 RST 摸不到则重新插拔
```

**烧录纪律（教训固化）**：烧任何非 navio_chron 环境（debug_boot/ble_diag/ble_test）后，
必须明确告知用户"当前板上固件 = X，不具备正式固件的 HID/手势功能"；诊断结束的默认动作
= 立即烧回 navio_chron。诊断固件没有侧键手势入口（只有 BOOT 插拔兜底）。

## 代码地图与核心约定

```
.github/workflows/pages.yml  GitHub Pages：构建统一页、manifest 与四件套并部署
editor/         Web 预设编辑器：SVG 设备图、预设库、150B 编解码与 Node 测试；
                presets/ 官方模板库（一预设一 JSON + 生成索引 index.json）
include/        引脚表(Pins.h)、参数(Config.h) —— 与硬件笔记一一对应
src/input/      矩阵扫描 + 编码器解码 → BtnEvent/EncoderEvent
src/action/     Action 模型：KeyChord / Consumer / Wheel（可带修饰键）
src/mapping/    出厂预设 + PresetRecord 150B 编解码（Schema 见 docs/PRESET_SCHEMA.md）
src/hid/        ITransport 接口 + Adafruit_TinyUSB 独立 HID + NimBLE 2.5 BLE
src/proto/      独立 Vendor HID（ID6 + 63B）+ ConfigProto v2；回调入队，主循环处理
                （线上协议单一事实源：docs/PROTOCOL.md；动态命令已实现）
src/ota/        OtaManager：双槽应用写入、SHA-256、激活、回退状态与本地自检确认
src/led/        WS2812：LedController（统一 Adafruit_NeoPixel 后端）
src/power/      电池电压估算（GPIO3 实测 1:2.2 分压 + 放电曲线表，充电中读数偏高属接受，见 D25）
tools/          add_fs_include.py / ota_upload.py / make_release.py（四件套+manifest）/
                build_templates.js（官方模板索引生成，改 presets/ 后必跑）；
                probe/ 含 hidapi、WebHID OTA、ROM 与统一入口探针、webflash_rules 纯规则及
                Node 测试、自托管 esptool-js bundle
release/        构建生成的四件套、manifest 与 ZIP（gitignored）
```

- **键码一律用 HID Usage ID**（`src/hid/HidUsage.h`），全链路不做 ASCII 转换。
- **BLE 报告细节（D12）**：报告不带 Report ID 前缀；连接后首帧需 prime 空报告；
  pressChord 必须经 `HidInputState` 写入键槽（缺失 = 发送全零报告，历史最贵 bug）。
- **Btn 枚举即物理位**：注释里的 R2C3 对应硬件笔记矩阵表，勿按枚举顺序臆测布局。
- **SideKey（SW11）全局保留**：短按松手=切预设 / 5-10s 内松手=BLE 配对（清绑定）/
  长按 10s=烧写（不清绑定）；长按不会先触发短按切预设。
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
| Web 编辑器交互、视觉资产、预设 CRUD 与本地库语义 | `docs/WEBUI_EDITOR.md` + `docs/PROJECT.md` 阶段状态 |
| 升级/降级依赖版本 | `docs/DECISIONS.md`（版本策略 D8：锁定已验证组合） |
| 固件行为、协议命令集或记录格式变化 | `src/Version.h` 的 `NAVIO_CHRON_FW_VERSION` 必须同提交递增（线上刷写器靠它区分新旧，见 D24 教训） |

原则：**文档陈述的状态永远不得超前于代码**（写"已完成"必须先实测）；
小 bug fix 不在表内、无需动文档。

## 当前状态与遗留

Phase 1 + 1b + 生产预设完成：**剪映 / Resolve（Win）USB/BLE 双模实战通过**。
大旋钮 B 相（IO40/R2R）已补焊复验。2026-10-27 完成 core 3.x 单轨与
Adafruit_TinyUSB 四独立 HID 迁移（D16）：hidapi / WebHID HELLO、GET_INFO、
现有双模输入与五环境构建均通过。遗留（按优先级）：
1. Phase 2：协议、动态预设与 USB OTA 核心验收完成（D19/D20/D21）；
   Web 统一刷写方案已冻结（D22，docs/WEB_FLASHING.md），单入口、三条核心路径及
   中断/负向验收及 GitHub Pages 线上 OTA 验收已完成；Web 编辑器 A 原型与模板分离已完成，
   B/C 均已通过真机验收，双键盘断开与换机重连已验证；刷写完成重启后不再重连验证，
   编辑器页头显示设备固件版本，新连接主动检查固件更新；RGB 九种灯效模式与编辑器选择已实现（D26，0.5.23），真机灯效与功耗待验收；下一步 D 体验收尾
2. 预设扩展：Premiere Win/Mac、Resolve/剪映 Mac、Procreate(iPad) 已入编辑器官方模板库
   （共 9 套，presets/ 一预设一 JSON；平台入 150B 记录 byte 13（D24），显示名不带平台词、
   chip 呈现，Cmd=GUI 修饰；快捷键按官方文档填写，待目标 App 实测微调；
   平台字节改动需重刷固件）；
   Final Cut 等更多模板待 D 阶段后评估，Android 平台待真实需求与实测快捷键
3. 电池接入后：睡眠唤醒、电量灯实测、BLE 功耗策略
4. 已知问题：BOOT 长按 3s 进下载模式在 BLE 连接时偶发失效（待查，兜底=BOOT 插拔）

上游参考在 `reference/`（gitignore，只读，无 LICENSE，只可参考不可复制）。
