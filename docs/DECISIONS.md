# 技术决策记录

> 每条记录：决策、理由、放弃的替代方案。日期为首决日期；重大变更时追加而非改写。

## D1. 技术栈：VS Code + PlatformIO + Arduino 框架（2026-10-25）

- 锁定 `espressif32@6.13.0`（Arduino core 2.0.17，与上游同代，USBHID 类成熟）。
- 必须 `build_unflags = -std=gnu++11` + `build_flags -std=gnu++17`：框架在用户 flag 之后
  追加自己的 `-std`，不用 unflags 会被覆盖回去。
- 放弃：Arduino IDE（依赖/工程管理弱）；纯 ESP-IDF（现有代码可参考、杀鸡用牛刀）；
  MicroPython/CircuitPython（实时扫描、BLE HID、长期维护均不占优）。
  若未来需要深度控制（功耗/USB 细节）可在 Arduino 框架内直接调 ESP-IDF API。

## D2. 分层架构 + ITransport 统一传输（2026-10-25）

输入扫描 → 逻辑事件（Btn/Encoder）→ 预设映射 → Action → ITransport。
USB 与 BLE 实现同一接口，主循环与映射层不感知传输方式。
理由：模式切换 = 换指针；测试时可用假传输层。

## D3. 连接模式：USB 挂载检测自动选择，SW1 只管电池（2026-10-25）

- 插线（TinyUSB 枚举成功）→ USB HID；否则 BLE。组合键手动覆盖留待后续。
- **2026-10-27 修订**：USB mounted 即保持 USB，包括主机 suspended；挂起只停止报告，
  不恢复 BLE 广播，避免睡眠主机旁的已配对设备收到误输入。
- SW1（K3-1280S）实测串联在电池正极 B+↔BAT+，不接 GPIO，固件无法读取其状态，
  "检测电池接通间接判断开关位置"不可行（插 USB 时开关状态不影响供电）。
- 实际使用语义自然成立：想用无线 → SW1 开 + 拔线；插线用 → 随时插。

## D4. 键码统一使用 USB HID Usage ID（2026-10-25）

预设/动作/传输全链路使用 HID Usage ID（非 ASCII、非各库私有键码）。
理由：USB `pressRaw` 与 BLE HID 报文同为 Usage ID，零转换；Win/macOS 通用。
放弃：Arduino `Keyboard.press('a')` ASCII 路径（修饰键组合受限、跨传输不一致）。

## D5. 预设：第一期编译期数据 + 侧键切换 + NVS 记忆（2026-10-25）

- 修改预设 = 改 `src/mapping/Presets.cpp` + 重新烧录（用户明确接受）。
- 切换预设 = 侧面微动 SW11 循环切换，`Preferences`(NVS) 记忆，重启保持。
- 第二期预设改走 NVS 动态加载 + 电脑端工具；Action 数据结构设计时保持可序列化。

## D6. 不复用上游代码（2026-10-25）

上游仓库无 LICENSE 文件，直接复制代码有法律风险。本固件从零实现，
仅参考其引脚定义（来自原理图交叉验证）与行为手感（编码器分频等）。
公开发布前与上游作者确认引用关系，或维持纯独立实现。

## D7. 编码器：轮询式四倍频 + 分频 2（2026-10-25）

1ms 全量轮询三通道（矩阵+编码器整轮 <100µs，无丢步风险）；格雷码表解码，
无效双跳变计 0 视为抖动；`ENC_DETENT_DIVISOR=2` 沿用上游手感（每棘齿 2 次触发），
上机实测后可调。放弃：中断方案（编码器抖动易淹没有限中断，上游即轮询且可用）。

## D8. WS2812 驱动自研，不用 Adafruit_NeoPixel（2026-10-25）

- 现象：Adafruit_NeoPixel 1.15.5（当时最新）在 S3 + Arduino core 2.0.17（IDF 4.4）
  上 `begin()/show()` 死锁——该组合走库内 IDF4 旧版 RMT 驱动路径
  （`rmt_driver_install`/`rmt_write_sample` 等待永不触发的 TX 完成中断），
  LED 信标固件实测卡死在首个 show()，且无看门狗复位（loopTask 默认无 WDT）。
- 修复：src/led/Ws2812.h，~70 行，基于核心 `rmtInit/rmtWriteBlocking` 新 HAL API
  （与板载 RGB `neopixelWrite` 同路径，本组合实测可用）。需求仅为 15 像素静态色。
- 放弃的替代方案：升 Arduino core 3.x/IDF5（NeoPixel 走新 API 且已知问题集中在大灯数场景）——
  需换 pioarduino 平台分叉并重验 USB 栈，为静态灯冒进不值；等有 core 3.x 的独立理由再整体迁移。
- 版本策略（由此确立）：**库版本锁定已验证组合，升级需理由**，不自动追新。
  当前外部库依赖为零；下一决策点是 BLE 阶段的 NimBLE 库选型。

## D9. 主固件关闭 USB CDC；调试走专用环境/板载信标（2026-10-25）

- 实测历史：CDC+HID 复合版本启动后不久失联；后续版本同时修掉"LED 每循环重刷"
  bug（rmtWriteBlocking 忙等打满 CPU）并关闭 CDC，结果稳定。
  **CDC 复合是否真凶未定**——LED bug 单独已足以致命。需要串口日志时先用
  debug_boot 环境（硬件 USB-Serial/JTAG）或板载 RGB 信标；将来有需要再做
  "开 CDC + 已修 LED bug" 的对照实验。
- 主固件现含三段式启动信标（绿=setup / 蓝=USB前 / 青×3=完成），未焊接阶段保留。

## D11. （撤销，并入 D10 修订）

原记录"core 3.12 NimBLE 适配不可用、BLE 转战 core 2.x"的结论系误判，2026-10-26 撤销。
证据：根因是 pressChord 键码未写入（D12）；core 3.12 + NimBLE 2.5.1 修复后实测
USB/BLE 双模全部正常。期间因降级 NimBLE 1.4.3 引入的真实差异仍保留在
BleTransport 的条件编译中（advertiseOnDisconnect、startServices、API 同名重载）。

## D12. BLE HID 实现要点与"空报告"教训（2026-10-26）

- **pressChord 键码写入槽位是史上最贵的一行**：`kbKeys_[slot] = usage` 缺失导致所有
  版本/平台发送全零报告；notify() 成功（绿灯）≠ 内容正确。调试手段升级：
  报告内容打日志（ble_diag 环境）才现形。原则：**诊断信号必须来自被测路径本身**。
- Report Map 采用 HijelHID 逐字节验证版；手写描述符的细微偏差会被主机静默丢弃。
- 报告值不带 Report ID 前缀（Report Reference descriptor 已标明归属）。
- 连接后首帧 notify 被主机握手期丢弃 → 发送前 prime 一帧空报告。
- 设备名必须放 scan response（Android 可见性）；NimBLE 1.4 需 advertiseOnDisconnect(false)。
- 跨 NimBLE 版本残留 bond 不兼容 → 升级后需设备端 deleteAllBonds + 主机端删绑定重配
  （或全片擦除）；多主机的旧绑定会自动直连，挤碎广播窗口导致"搜不到"。
- 未焊接矩阵悬空噪声会风暴式触发事件（SideKey→releaseAll 空报告风暴）→
  测试构建用 NAVIO_IGNORE_MATRIX 屏蔽；正式固件不受影响（焊接后无此现象）。

## D13. 预设策略：桌面端管理 + NVS 安装制，固件只带出厂示例（2026-10-27）

- 背景：讨论 Win/Mac 预设组织时评估过两条路——①固件内每软件×平台完整变体
  +全局平台模式过滤循环列表（按住 K9+侧键切平台）；②修饰键翻译层（MOD_PRIMARY
  运行时映射 Ctrl/Cmd）。两者都被否决。
- 用户洞察：每人的实际预设需求有限（几个），会爆炸的是"固件内置所有预设"这个思路；
  需求千人千面，正确的扩展路径在**桌面端**。
- 最终架构：桌面端管理软件（官方预设库 + 自定义编辑 + 图形界面/SVG 设备图）负责
  挑选/定制/下发；键盘 NVS 只存用户已安装的少量预设（侧键循环恒定不膨胀）；
  编译期预设（JianYing/Resolve/Test/F13）降级为出厂示例与无桌面端时的兜底。
  Win/Mac/iPadOS 差异由用户在桌面端选择对应变体解决，固件不做平台概念。
- 影响：Phase 2（桌面端工具+NVS 动态预设）从远期提前为下一主战场；
  Action 数据结构设计需保证可序列化（JSON）与版本化。

## D14. Phase 2 方案定稿：Vendor HID 通信 + 分片 JSON 协议 + Web-first 桌面端（2026-10-27）

**通信通道：Vendor HID 接口**（否决 CDC 串口方案）
- USB 复合设备加第四个接口（厂商自定义 HID，双向 64 字节报告）
- 理由：QMK/VIA/ZMK 等社区键盘配置工具的行业惯例路径——免驱、无 COM 口心智负担、
  设备枚举稳定（VID/PID+usage 定位）；CDC 在 D9 的嫌疑已洗清但仅留作开发调试口
- 帧协议（分片重组式，传输无关——BLE 下发将来直接复用同一帧格式）：
  `| magic 0x4E | cmd 1B | seq 1B | total 1B | payload ≤59B |`，每帧 CRC8 + 整体 CRC16
- 命令集：HELLO / GET_INFO / GET_PRESETS / WRITE_PRESET / DELETE / MOVE / LED_PREVIEW /
  ACK / ERR(原因码)；大 JSON 按帧分片，固件重组→解析→校验→写 NVS→回执

**预设数据**：
- JSON、人读键名（如 "ctrl+b"，网友手改友好；桌面端负责双向转换），schema 带版本字段
- NVS 布局：每预设一个 blob key（`preset_0..5`）+ 顺序/计数 key；**上限 6 个**
- 坏数据防御：CRC 双层 + 解析失败自动回退编译期出厂预设（键盘永不砖）
- 解析器：ArduinoJson；写入预设期间暂停 HID 输出
- 交换格式：单文件 `.navio.json`（含 manifest：作者/版本/平台标签）——社区贡献载体
- **RGB 灯效段**（用户提出）：preset.rgb = { mode, colors{} }；首版四模式：
  static（各键固定色）/ follow（跟随 accent，现行为）/ breath（呼吸）/
  reactive（暗底+按下亮起渐熄，输入层联动）；固件 LedController 加 20ms 帧驱动灯效引擎；
  rainbow/涟漪等后续作为引擎上的新模式函数
- 桌面端实时灯效预览走 LED_PREVIEW 命令（改灯不落盘）

**桌面端：Web-first + Tauri 兜底**
- 一套 TypeScript 前端（SVG 设备示意图、可视化预设编辑、预设库站点）+
  Transport 抽象（WebHidTransport / TauriHidTransport(hidapi-rs) 两实现）
- Web（WebHID）零安装为主路径；Tauri 桌面壳（~8MB）覆盖 Safari/Firefox 用户
- 否决：Electron（150MB 过重）、Python GUI（分发差）、Flutter（hidapi 生态弱）

**实施顺序**：固件侧三件套（vendor HID 接口 → JSON/NVS 动态加载 → 帧协议）
→ Web 端最小闭环（连接→读预设→改一键→下发→验证）→ 铺开界面与预设库。

## D15. Phase 2 通道复核：保留内置 TinyUSB + Vendor HID，报告数据改为 63B（2026-10-27）

- 撤销 `17cb9ac` 的探索性判断：带 Report ID 的 Vendor page **可以**被
  `esp_hid_parse_report_map` 注册并路由，不需要迁移 Adafruit_TinyUSB 全栈。
  实机以 ID 6 + `_onOutput`/`_onSetFeature` 双回调完成 hidapi HELLO 双向闭环，
  收到 `{"proto":1,"fw":"0.3.0-dev","name":"Navio Chron"}`，键盘/鼠标/Consumer 同时正常枚举。
- Arduino `USBHID` 把各描述符拼成**同一 HID 接口的多个 Application Collection**，
  不是独立 HID 接口；因此有/无 Report ID 不能在该拼接描述符内混用，#9288 的去 ID
  建议不适用于本设备。D14 的“第四个接口”修订为“第四个 Application Collection”。
- 全速端点包上限 64B，Report ID 也占 1B：**线上报告 = ID(1B) + 数据(63B)**。
  原“ID + 64B 数据”需要 65B，设备→主机发送失败。帧格式相应修订为
  `magic/cmd/seq/total(4B) + payload(≤58B) + CRC8(1B) = 63B`；整体 JSON 的长度和 CRC16
  字段在实现分片协议时显式定义，不能依赖固定报告的尾部零填充判断 JSON 长度。
- TinyUSB 接收回调只负责拷贝/入队，协议处理和阻塞式 `SendReport()` 在主循环 `poll()` 执行。
- CDC 对照实验也已通过：`USB_MODE=0 + CDC_ON_BOOT=1` 可复合枚举并完成串口回环。
  `CDC_ON_BOOT` 会在 `setup()` 前自动 `USB.begin()`，所以运行时再设 VID/PID 无效；
  先前“无 VID_CAFE COM 口”是检测条件与初始化时序问题，不是 CDC 不可用。CDC 仍只作调试备选。
- 当前合入状态：实验工作区验证通过；主分支的 VendorHid 仍暂停，待移除诊断上报、
  完善有界接收队列和帧协议后再启用，不视为 Phase 2 功能已完成。

## D16. Core 3.x 单轨 + Adafruit_TinyUSB 独立 HID 接口（2026-10-27）

- 撤销 core 2.x 回退路径：所有正式/诊断环境统一 core 3.12 + NimBLE 2.5.1；
  删除 `_core2_tools_base`、NimBLE 1.4 分支和自研 `Ws2812.h`，后续问题在当前平台向前修复。
- USB 设备层迁移到 `Adafruit TinyUSB Library@3.7.7`：Keyboard(1)、Mouse(2)、
  Consumer(4)、Vendor(6) 各自独立 HID 接口，描述符与回调按 instance 归属，
  不再经过内置 `USBHID` 的全局拼接和 report-map 路由。`ITransport`、BLE、预设及
  Vendor 的 **Report ID 6 + 63B 数据**线上格式不变。
- 实例数由 `include/navio_tusb_config.h` 统一设为 4；`tools/add_fs_include.py`
  同时向库环境提供项目 include 与 Adafruit src 路径，不修改第三方库副本。
- 正式固件保持 `USB_MODE=1 + CDC_ON_BOOT=0`，在全部接口注册后手动 `USB.begin()`。
  实测原生 CDC 固定端点与第三个独立 HID 同时存在会枚举失败；移除 CDC 后四个接口正常。
  串口日志只走 `ble_diag` / `debug_boot` 等专用环境，不在正式复合设备中常驻。
- Vendor 回调只将完整帧写入 4 项 FreeRTOS 队列，`poll()` 在主循环执行协议与发送；
  `ConfigProto` 只接受固定 63B 帧，HELLO/GET_INFO 不再静默截断。
- 实机验收：四个独立 HID 接口正常枚举；hidapi 与 Windows WebHID 的 HELLO 均返回
  原 JSON，GET_INFO 返回完整能力 JSON；现有 USB/BLE 输入、预设切换与 BLE 重连通过；
  全部五个构建环境通过。D15 的 63B 与回调入队
  原则保留，其“无需迁移 Adafruit”判断被本决策修订。

## D17. 独立 HID 的跨接口组合动作必须显式排序（2026-10-27）

- 现象：Test 预设的裸滚轮正常，剪映的 Alt/Ctrl+滚轮被当成普通滚动；BLE 正常。
  诊断计数显示鼠标报告全部被 USB 栈接受，Windows 也收到正确修饰键和滚轮增量，
  但独立接口的报告到达顺序不再隐含保证，滚轮可能先于修饰键被应用处理。
- 组合滚轮改为非阻塞三段调度：按下修饰键 → 等待 3ms → 发滚轮 → 等待 3ms →
  释放修饰键。切预设、换传输或溢出恢复会取消未完成的后续动作，不补发过期滚轮。
- 不把发送 API 返回成功等同于主机应用收到正确组合；跨接口问题需要同时观察设备计数、
  主机修饰键状态和实际输入事件。Boot Mouse 协议不是本问题根因，保持原声明。
- NimBLE 自带的 `advertiseOnDisconnect` 关闭，广播只由主循环按连接意愿管理，
  避免库的自动恢复与传输层状态机双重控制。

## D18. 配对档位在松手时确认，烧写不得清除绑定（2026-10-27）

- 原侧键状态机在长按 5s 时立即清绑定，继续按到 10s 进烧写也会先清除 BLE 绑定，
  因而每次烧录后都需要重新配对；这不是刷写擦除 NVS，而是手势副作用。
- 修订为：5–10s 内松手才进入配对（清绑定+广播）；达到 10s 只进入烧写，
  不再执行配对。灯光进度语义不变，烧写前的阻塞双闪通过 `LedController::flush()` 立即输出，
  普通状态灯仍走 dirty + tick 按需刷新。

## D10. 主环境：官方 espressif32 8.0.0 = Arduino core 3.12.x（2026-10-25 定，10-26 复核）

- 动机：NimBLE-Arduino 2.x（BLE 阶段必需）仅支持 core 3.x/IDF5；官方注册表原生携带
  core 3.12 无需 pioarduino 分叉；core 3.x 上 Adafruit_NeoPixel 走新 RMT 路径可用。
- **2026-10-26 修订**：BLE 调试期间曾误判"core 3.12 + NimBLE 适配层不可用"并临时回退
  core 2.x + NimBLE 1.4.3；根因实为自身 pressChord 未写入键码（见 D12），core 3.12 +
  NimBLE 2.5.1 实测完全可用，主环境回归。误判教训：多版本组合排查时未先验证最小发送链路。
- **2026-10-27 修订（D16）**：core 2.x 回退路径已撤销；LED 统一 Adafruit_NeoPixel，
  BLE 统一 NimBLE 2.5.1，USB 迁移 Adafruit_TinyUSB 独立接口。历史兼容分支不再维护。
- PIO 踩坑（core 3.x 特有）：库依赖声明改用 idf_component.yml，PIO LDF 读不到，
  USB 库编译 MSC 模块缺 FS.h —— `pre:tools/add_fs_include.py` 在库环境克隆前注入路径
  （post 阶段注入无效；build_flags 里 `{platformio.packages_dir}` 不展开）。
