# Navio Chron 硬件笔记（PCB V1.0，2026-09-04/05）

> 信息来源：`SCH_Board1_Main_with_SuperMini_V1.0.pdf`、`SCH_Board2_Daughter_V1.0.pdf`（本目录）、
> 上游固件 `reference/Navio-Chron-upstream/NavioChronT2_SuperMini_EMUAI.ino`、
> 上游 BOM `reference/Navio-Chron-upstream/BOM of Navio Chron.xlsx`、
> 主控模块 wiki https://wiki.nologo.tech/product/esp32/esp32s3/esp32s3supermini/esp32S3SuperMini.html 、
> 实机确认（2026-10-25）。
> 硬件作者开源主页：https://oshwhub.com/cityforest/ （EDA 原始工程可从此处导出）
>
> 以下结论 = 原理图（视觉识别）与上游固件代码交叉验证的结果。标注 **[待确认]** 的项尚有歧义。

## 主控模块（nologo ESP32-S3 SuperMini）

- 芯片：ESP32-S3FH4R2 → **4MB Flash（QIO）+ 2MB 内嵌 PSRAM**（memory_type = qio_qspi）
- 尺寸 22.52×18mm；原生 USB（Type-C，无 USB-UART 桥接），HID 可用
- 背面 B+/B- 焊盘：外接 3.3~6V 电源，模块内置充电（可通过 USB 给电池充电，充电芯片型号 wiki 未标明，充电状态无引出）
- 板载 RGB/蓝色 LED 共用 **GPIO48**（本项目未使用该脚）
- 烧录需 BOOT+RESET 进下载模式（wiki 说明；正常 Arduino 烧录流程同样适用）

## 总体架构

- 双板设计：Board1 主板（含 ESP32-S3 SuperMini 模块、电池、电源、9~12 个按键）+ Board2 子板（2 个编码器、微动侧键、tact 按键），通过 **10Pin 1.27mm 板对板连接器**（主板 ZX-PM 插 / 子板 ZX-PZ 座）互连。
- 主控：**ESP32-S3 SuperMini**（淘宝 757262224552），原生 USB（USB OTG/HID 可用），无额外 USB 桥接芯片。

## 物理布局（照片见 photos/device_top.jpg，2026-10-25 摄）

- 外观：蓝灰色"装甲式"斜角外壳，双层结构，橙色点缀，多颗银色螺丝，风格类似 TourBox。
- **两板分工 → 部件分区**（原理图确定，照片可对照）：
  - Board2（子板）区域：大旋钮（SW41，IO39/40）、滚轮（ENC3，IO14/15，侧向安装露出橙色轮缘）、滚轮下压微动（SW21）、侧面微动（SW11）；
  - Board1（主板）区域：中央旋钮（SW23，IO8/9）、全部 12 颗带灯按键、3 颗状态灯、电池座、SuperMini。
- **按键物理位 ↔ K1..K12 对应**（2026-10-26 装机实测回填，Test 预设输出 `1234567890-=`）：

  | 物理位置 | Btn | 矩阵位 | 上游剪映预设功能 |
  |---|---|---|---|
  | 顶部一排 3 长键，左→右 | K1 / K2 / K3 | R1C2 / R1C3 / R1C4 | 左剪裁 q / 切分 Ctrl+B / 右剪裁 w |
  | 中央旋钮右侧双键，左→右 | K4 / K5 | R2C4 / R2C5 | 撤销 Ctrl+Z / 重做 Ctrl+Shift+Z |
  | 右下角双键，左→右（播放键更靠右/下） | K7 / K6 | R3C4 / R3C5 | 删除退格 / 播放暂停空格 |
  | 箭头簇：上/下/左/右 | K8 / K11 / K10 / K12 | R3C3 / R4C3 / R4C2 / R4C4 | ↑ ↓ ← → |
  | 滚轮左侧偏下单独键 | K9 | R3C2 | Alt（上游用法） |
  | 中央旋钮按压 SW23 | EncCenterPress | R2C3 | 'v'（上游用法） |
  | 大旋钮按压 SW41 | EncLargePress | R4C1 | 空格=播放（上游用法） |
  | 滚轮下压微动 SW21 | WheelPress | R2C1 | Esc（本固件 Test 预设，实测有效） |
  | 侧面微动 SW11 | SideKey | R1C1 | 按下切预设 / 5–10s 松手配对 / 10s 烧写（本固件） |

- 实测备注（2026-10-26/27）：三个编码器出厂方向与使用习惯相反，已在 Pins.h 统一对调
  A/B 相位全局反转；大旋钮 B 相补焊后已复验；SW21 实测有效（Esc）。

- 编码器组合（上游 encoderActionMap layer0，与说明书标注一致）：中央旋钮=←/→ 进退；
  大旋钮=Alt+鼠标滚轮（时间轴）；滚轮=Ctrl+鼠标滚轮（缩放）。
- 上游软件分层：0=剪映预设，1-4 空白，5=专用设置层；侧键单击循环、长按进设置层。
- Phase 2 图形化配置界面的设备示意图：以照片为底稿描 SVG，每个输入定义坐标；
  WS2812 链序（K1→K12 = LED3→LED14，见 GPIO 表）可用于界面上的按键灯颜色实时预览。

## GPIO 引脚映射（已与上游固件代码逐项核对一致）

| 功能 | GPIO | 网络名 | 备注 |
|---|---|---|---|
| 矩阵行 ROW1 | 13 | ROW1 | 扫描时输出低，平时高 |
| 矩阵行 ROW2 | 12 | ROW2 | |
| 矩阵行 ROW3 | 11 | ROW3 | |
| 矩阵行 ROW4 | 10 | ROW4 | |
| 矩阵列 COL1 | 6 | COL1 | 输入上拉 |
| 矩阵列 COL2 | 5 | COL2 | |
| 矩阵列 COL3 | 4 | COL3 | |
| 矩阵列 COL4 | 2 | COL4 | |
| 矩阵列 COL5 | 1 | COL5 | |
| 编码器 SW23（主板） | 9 / 8 | R1R / R1L | 代码注释：中央旋钮 |
| 编码器 SW41（子板） | 39 / 40 | R2L / R2R | 代码注释：大旋钮 |
| 编码器 ENC3（子板） | 15 / 14 | R3L / R3R | 代码注释：滚轮 |
| WS2812 数据 | 7 | LED | 15 颗：0-2 状态灯 + 3-14 按键灯 |
| 电池电压检测 | 3 | — | ÷2 分压 + ADC 11dB，代码 `mV*2` |
| U9 SDA / SCL | 41 / 16 | SDA / SCL | 经 100Ω（R9/R10），功能**[待确认]** |

- 编码器 A/B 均有 10k 上拉：子板 R15/R16（ENC3）、R24/R25（SW41）；主板 R13/R14 **[待确认：可能为 SW23 上拉而非电池分压]**；电池分压电阻可能是 R19/R20（1.2k×2）**[待确认]**。

## 矩阵占位（4 行 × 5 列，16 个物理开关）

| | COL1 | COL2 | COL3 | COL4 | COL5 |
|---|---|---|---|---|---|
| ROW1 | **SW11 侧面微动** | UA12 (LED3) | UA13 (LED4) | UA14 (LED5) | — |
| ROW2 | **SW21 滚轮下压微动** | — | **SW23 编码器按压** | UA24 (LED6) | UA25 (LED7) |
| ROW3 | — | UB32 (LED11) | UB33 (LED10) | UB34 (LED9) | UB35 (LED8) |
| ROW4 | **SW41 编码器按压** | UA42 (LED12) | UA43 (LED13) | UA44 (LED14) | — |

- 每个开关串联 SM4007PL 二极管防鬼键（16 颗）。
- 括号内 LEDn = WS2812 链路索引：U17-U19 状态灯为 0-2，按键灯 3-14，链尾 UA44。
- 12 颗按键灯全部在主板（热插拔轴座+WS2812B 灯板）；上游固件 `ledMatrix` 与本表一致。
- 实机确认（2026-10-25，PCB 丝印）：两个 EC11 编码器（SW23/SW41）自带按压，即表中 R2C3 / R4C1 两格；
  TTC 滚轮编码器（ENC3）本身无按压，**滚轮的"按压"由 SW21 微动提供**（R2C1），
  **SW11 为子板侧面的独立微动**（R1C1，上游固件用作图层切换，本固件用作预设切换）；
  U9 未贴片（空焊盘，预留功能，SDA/SCL→IO41/IO16 视为保留引脚）。

## 电源路径

```
JST 1.25-2P 电池座 (Battery2)
  B+ ──[SW1 拨动开关 K3-1280S]── BAT+ ──→ SuperMini 背面 BAT+ 焊盘
  B- ─────────────────────────→ GND
USB 5V → SuperMini 5V 引脚（VBUS）
B+ 或 BAT+ ──[÷2 分压]── GPIO3（电量检测）
```

- **SW1 = 电池正极通断开关**，不接任何 GPIO，固件无法直接读取其状态。
- 意味着：插 USB 时即使 SW1 关断电池，设备仍由 5V 供电运行 → 可用"USB 是否枚举"来自动判别有线/无线模式。
- **充电**：无独立电源管理芯片；充电电路内置于 SuperMini 模块（B+ 焊盘，USB 可充电，wiki 未标明充电芯片与电流，充电状态无引脚）。接电池前建议自行确认模块充电规格与电池容量匹配（BOM 计划 2500-4000mAh）。
- U9（ASIC-SKT493，SOIC-8）**未贴片**，仅预留焊盘；其 SDA/SCL 走线接 IO41/IO16，这两个引脚视为保留，不作他用。

## 板间连接器 U20（主板侧 ZX-PM1.27-2-5PU，10P）

子板侧已确认承载：R2L、R2R、R3L、R3R（两个子板编码器）、ROW1、ROW2、ROW4、COL1、GND。
完整引脚分配及子板 3V3 供电来源**[待确认]**。

## 上游仓库相关

- 仓库：https://github.com/Cityforest2000/Navio-Chron （浅克隆于 `reference/Navio-Chron-upstream/`）
- `Navio Chron T2 v0.1.zip` = 可直接烧录的固件镜像（.bin + bootloader + 分区表）。
- 上游 **无 LICENSE 文件**——后续公开发布需注意：新固件为全新实现、仅参考引脚定义，避免直接复制上游代码，或先取得作者授权。
- 上游 README 计划：v1 纯 USB HID；后续走 HID Vendor + Python 后台。我们的方案（原生 USB HID + BLE 双模）与上游路线不同，互不冲突。
