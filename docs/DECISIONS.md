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

> 2026-10-27 修订（D19）：帧格式以 `docs/PROTOCOL.md` v2 为准；桌面端保留
> `.navio.json`，设备/NVS 改用二进制记录，不再采用 ArduinoJson。

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
  不再执行配对。短按切换也延后到松手，由同一状态机按时长统一裁决，长按不再先切预设。
  灯光进度语义不变，烧写前的阻塞双闪通过 `LedController::flush()` 立即输出，
  普通状态灯仍走 dirty + tick 按需刷新。

## D19. Config Protocol v2 与桌面 JSON / 设备二进制分工（2026-10-27）

- 协议单一事实源为 `docs/PROTOCOL.md`：Vendor HID ID6 + 63B 数据，帧头
  `magic/cmd/seq/total` + 58B payload + CRC8；普通消息另带显式 bodyLength/CRC16。
  算法固定 CRC-8/SMBUS 与 CRC-16/CCITT-FALSE，空正文和补零规则均显式定义。
- 正文上限从实现骨架的 1024B 缓冲区正式定为 2048B（最多 36 片），为单套
  二进制预设与后续 RGB 配置保留余量，不使用动态分配。
- 主机到设备逐片 ACK，重复片幂等；大响应不主动连发，最终 ACK(MORE) 带整体长度/
  CRC16，主机用 `READ_CHUNK(0x09)` 逐片拉取（每片 55B）。`READ_PRESET=0x08`。
  小响应直接附在最终 ACK 的数据上限为 51B，不是 54B（需扣 ACK 头 3B）。
- 除 READ_CHUNK 外，合法 seq=0 总是隐式取消旧事务并开始新事务；设备 poll 中
  3000ms 无合法片即清空收发状态。frame 0 立即校验 total/bodyLength/上限。
- 修订 D14：`.navio.json` 只作桌面交换与社区分享格式，桌面负责校验、双向转换和
  版本降级；固件/NVS 使用带版本、显式长度和稳定 ID 的二进制记录，不引入 ArduinoJson。
- v2 首轮实现与验收已完成：HELLO 小响应、GET_INFO 大响应拉取、单片/多片请求、
  重复/乱序/取消、CRC 错误、超长与 3 秒恢复均通过 hidapi 故障注入；HELLO/GET_INFO
  同时通过 WebHID，主机参考实现 15 项检查通过，五环境构建通过。
  下一步：原子 NVS 动态预设 → Web 端最小闭环。

## D20. 二进制预设 Schema v1 与双 manifest 原子提交（2026-10-27）

- `docs/PRESET_SCHEMA.md` 冻结 150B 记录：显式长度/版本/稳定 ID、24B 名称缓冲、
  accent、22 个固定 5B 动作及记录 CRC16；禁止直接序列化 C++ 对象或依赖 padding。
- 命令正文：GET_PRESETS 以 `[count][activeId]` 开头，再返回按顺序排列的
  `[id][nameLength][name]` 清单；READ_PRESET 返回完整记录；WRITE_PRESET 接收完整记录；
  DELETE `[id]`；MOVE `[id][beforeId]`（0 表示末尾）。最多 6 套，禁止删除最后一套。
- NVS 使用 `p_XX` 记录键和 `manifest_0/1` 双槽：记录先完整写入，manifest 再写另一槽，
  只有新 manifest 完整落盘才替换运行时安装列表。中断只留下未引用记录，不暴露半套状态。
- 出厂 ID 缺省时使用编译期数据，同 ID 动态记录覆盖；自定义或引用记录损坏则整个
  manifest 回退出厂。活动预设保存 activeId，不再保存易漂移索引。
- 协议执行与响应分离，重复末片只重发响应；变更期间暂停 HID 并清动作快照，
  完成后刷新 LED。动态命令已通过 hidapi：写读逐字节一致、换序、删除、容量限制、
  非法/不支持记录拒绝及原配置恢复；五环境与原协议故障回归通过。
- 实机验收完成：动态预设输出 K1=a、K2=Ctrl+B 且灯光正确；重启后清单与 activeId
  持久化；连续写入中断电后配置完整可读，已提交记录 CRC 正确，未提交记录不产生
  半套 manifest。测试数据已清理，固件动态预设阶段完成，下一步 Web 编辑器。
- 后续修订：动作槽位锚定 Btn/Enc 枚举与方向顺序；GET_PRESETS 增加 activeId；
  DELETE 明确为移除安装项而非复活出厂版；LED_PREVIEW 冻结为 accent+rgbMode 但暂不实现；
  `code=0 && mods=0` 的 KeyChord 判非法，空动作只能使用 None。
- 恢复加固：重复中间片重发 CHUNK；完整末帧用于识别重传，最终 ACK/ERR/MORE 统一缓存重放，
  包括单帧命令与失败结果，避免重复执行或把失败改成假 OK。HELLO 统一走大小安全响应路径。
  manifest 选中槽记录损坏时先尝试另一槽，后续 generation 基于已见最高值；两槽均不可加载才
  回退出厂。新增重传回归及原 hidapi/动态预设/五环境测试通过。

## D21. 完整 USB OTA 先行，协议与实现分阶段验收（2026-10-29）

- 在 Web 编辑器之前完成完整 OTA，避免固件升级与 Web 两端同时联调；复用 Config Protocol v2
  的 Vendor HID、分片重传和最终响应重放，不引入另一套 USB DFU 类或线上帧格式。
- 当前 default 分区已有 otadata/app0/app1；本地 Arduino Update 已确认支持整包 SHA-256，
  `Update.end()` 在镜像校验后设置下一启动分区。只升级应用 firmware.bin，不改 NVS、分区表或 bootloader。
- `docs/OTA_PROTOCOL.md` 已评审冻结（2026-10-29）：追加
  OTA_BEGIN/WRITE/FINISH/ABORT/STATUS/REBOOT/CONFIRM（0x0A–0x10），顺序块最大 2044B，
  SHA-256 后才激活，显式重启并做首启动确认。
  首版不做断点续传，接收中断从头重写，以简化恢复状态。
- 完整验收必须包含首启动自动回退、断电/断连、错误镜像、A/B 连续升级、配置与绑定保留；
  已静态确认当前包及 qio_qspi sdkconfig 启用 BOOTLOADER_APP_ROLLBACK_ENABLE，且未启用
  anti-rollback，仍须上机验证，不把“能写入”当成完整 OTA。
  侧键 10 秒和 BOOT 插拔救援在验收前保留。随后实现主机工具与固件侧。
- 实施修订：首启动确认由“必须主机重连 CONFIRM”改为“设备本地自检成功后自动 CONFIRM”。
  Arduino 默认 verifyOta 会无条件确认，项目保留 verifyRollbackLater 延迟到预设加载与
  USB Vendor HID 注册检查后再确认；主机 CONFIRM 仅作幂等诊断，不再决定升级是否保留。
  线上命令与状态布局不变，避免用户未重连导致下次复位意外回退。
- 实现与核心实机验收完成（2026-10-29）：OtaManager + ConfigProto 全命令、tools/ota_upload.py、
  hidapi/WebOTA 探针。A/B 双向及连续升级约 45–46s，BEGIN<0.1s、FINISH≈0.1s；SHA-256 错误、
  非 ESP 镜像、错 offset、ABORT、30s 超时均不激活。PENDING_VERIFY 复位回退已实测，
  本地自检自动 VALID 已实测；Web 传输中断后原槽 VALID，预设清单保持不变。
  五环境构建、原协议/动态预设/JS 16 项回归通过。WebHID 重启后允许用户重新选择设备再验证确认。

## D22. Web 统一刷写：OTA 优先、ROM 迁移、BOOT 救援（2026-10-29）

- `docs/WEB_FLASHING.md` 已评审冻结：普通用户无需本地工具链；Navio 走现有 WebHID OTA，
  演示固件用 esptool-js 内置复位进入 ROM 后完整刷写，无法自动化时统一进入一次 BOOT 救援。
  不对未知固件猜 1200bps/DTR/RTS，不追求 100% 免按键。
- manifest 由 make_release.py 从 bootloader 构建产物的镜像头解析 flash 参数：当前实测为
  DIO/80MHz/4MB，地址固定为 0/0x8000/0xE000/0x10000；同时提供 OTA firmware.bin 与
  ROM 四件套及 SHA-256。WebHID 过滤器与版本规则也归入 manifest，页面不得另建事实源。
  初版曾按 platformio.ini 写成 QIO，实机回读发现构建产物实际为 DIO，改写镜像头后会导致
  看门狗启动循环，故以产物为准。
- NVS 按身份而非路径处理：HID VID/PID 匹配即视为 Navio，即使 HELLO 失败也在 ROM 路径保留
  预设；仅能取得 Web Serial 的未知设备默认干净刷写，但必须明确告知并确认擦除范围。
- 首版进入 ROM 不使用自定义 reset profile，CustomReset 仅实测需要时增加；esptool-js 固定版本
  自托管并记录 SRI/完整性摘要和 Apache-2.0 许可。实测 0.7.0 原生 USB 的刷后 HardReset 不产生
  EN 脉冲，ROM 探针刷后显式拉高 RTS 100ms 再释放（DTR=false）。实施顺序为 manifest/ROM 探针
  → 统一入口 → 实测矩阵。
- 统一入口开工前修订：Navio 身份在当前升级会话内锁存，跨 BOOT 与串口重枚举继续决定
  `eraseAll=false`，但不跨页面刷新持久化；确认页同时明示“保留预设”或“擦除数据”。ROM 裸探测
  固定用 `main("no_reset")`，失败直接救援，不做复位尝试。stable 同版本显示已最新并结束，dev
  同版本仅允许显式重装；SemVer 遵循 pre-release 规则。OTA 验证目标槽与 VALID，ROM 直刷验证
  app0 与 UNDEFINED(6)，不得混用断言。演示固件自动复位仍须实测 profile，不作提前承诺。
- 统一 OTA 实机发现 Chrome 重枚举后可持续 `getDevices()=[]`（60 秒仍为 authorized=0），
  属授权未恢复，延长轮询无效。初版自动重连 10 秒后转用户手动重新授权验证。
- 2026-11-05 UX 修订：正常 OTA/ROM 写入完成并发出重启后，网页直接显示完成，不再自动重连、
  重新授权或复查版本与预设；OTA 由设备本地自检自动 VALID，无需主机 CONFIRM。只有恢复上次
  中断的 OTA 会话时才保留重连，以便继续新的写入。完成态不宣称网页已验证重启后的运行状态。
- 首个演示固件 profile 实测通过（2026-10-29）：SuperMini FastLED 演示应用（Arduino 3.3.7）
  使用 303A:1001 USB-Serial/JTAG；运行中 no_reset 失败且 RGB 不受影响，default_reset 可进入
  ROM。自动复位与写入必须保持同一串口会话，不能断开后再 no_reset。统一页仅对该实测 VID/PID
  开放自动入口；未知设备确认 eraseAll=true 后完整迁移，HELLO 与 app0/UNDEFINED 通过。
  原始 4MB Flash 已备份校验；恢复写入与整片哈希校验已通过，恢复后 RGB 演示正常。
- 单入口复测发现 RTC Force Download Boot 标志可跨复位保留，导致刷后仍进 DOWNLOAD，与物理
  BOOT 无关。寄存器 `0x6000812C` 的 bit0 已在当前 ESP32-S3 头文件核实；ROM 刷后先清除该位
  再发 EN 脉冲。演示备份恢复后自动迁移实测无需断电即出现 Navio。
- 物理 BOOT 进入的救援路径另行实测：`GPIO_STRAP=0x22` 时清 RTC 并显式释放 DTR/RTS 仍留在
  下载器，普通 core reset 不重采样 strapping。采用乐鑫官方 watchdog-reset 配置：写
  `0x600080B0=0x50D83AA1`、`0x6000809C=2000`、`0x60008098=(1<<31)|(5<<28)|(1<<8)|2`，
  再锁 WPROTECT，触发完整系统复位。网页只读探针已验证自动进入 Navio；RST/断电仅作兜底。
  单入口 OTA、BOOT/ROM 与演示自动迁移均完成核心验收。
- 托管定案为 GitHub Pages：`.github/workflows/pages.yml` 在 main 与手动触发时构建同一
  `navio_chron` 产物和 manifest，发布根目录 `index.html`、`manifest.json` 与四件套，避免
  project Pages 子路径问题。发布页源复用统一探针，仅将默认 manifest 改为 `./manifest.json`；
  release 构建产物仍不入库。2026-10-30 已通过 `a482bfa` 首次部署
  https://isilcala.github.io/Navio-Chron-Firmware/ ，线上 manifest 与 firmware SHA-256 一致；
  线上 OTA 验收已通过（2026-10-30）。

## D23. Web 预设编辑器：俯视 SVG、本地库先行、显式 upsert（2026-10-30）

- `docs/WEBUI_EDITOR.md` 冻结交互与数据约束：中央 SVG 俯视图点选、左侧本地库、右侧动作面板，
  先静态原型再接设备；不引入框架或 3D，不为编辑器新增线上协议。
- 数据模型为 21 个可编辑槽 + SideKey 锁定槽；每个编码器一个热点，面板分别编辑 CW/CCW/按压，
  旋转槽不限制为 Wheel。锁定槽读入→写回原样保留。
- 本地 UUID 与设备 presetId 分离；同 ID WRITE_PRESET 是 upsert，安装前必须显式确认替换，
  满容量采用同 ID 覆盖而非先删后写。名称按 23B UTF-8 校验，不按字符数。
- 批量应用不宣称原子：先全量校验，逐条提交，失败显示 X/Y 并重读对账。MOVE 使用 beforeId 锚点，
  删除活动预设显示切换结果，activeId 靠 focus/重连/应用后刷新。
- 页面预留独立灯光页签和预览层，但首版不承诺 LED_PREVIEW；Pages 同时承载编辑器与刷写页。

## D24. 150B 记录 byte 13 承载平台元数据；D13 精化而非松动（2026-11-02）

- 动机：模板显示名去掉平台后缀后，设备读回的记录必须自带平台（150B 是设备侧唯一信息源），
  否则同名变体在设备分区无法区分。字符串后缀拼接是启发式（超长退回、endsWith 误判），不采用。
- byte 13 = `platform`：`0=win`（历史记录天然值，旧 NVS 零迁移）/ `1=mac` / `2=iPad`；
  byte 12 继续保留（应急），byte 11 归属 rgbMode 不动。记录版本保持 1——旧固件只拒绝
  非零平台记录（即装 mac/iPad 预设失败），win 记录照常，比升 v2 部署平滑。
- 固件改动仅删除 byte 13 的零校验，**不解释其值、永不据此分支**；D13 精化为
  "固件不感知平台，但记录可携带平台元数据供宿主呈现"。平台是呈现数据，不是行为数据。
- 扩展策略（写入 PRESET_SCHEMA.md）：需要更多字段时优先升 record 版本；位打包
  （如 `[rgbMode:4][platform:4]`）仅作字节耗尽时的应急方案。
- 编辑器侧：显示名不带平台词，列表以平台 chip 呈现（模板/本地/设备分区一致，设备侧
  平台来自记录读回）；平台改动与主题色同等对待（标 dirty、随应用写入设备）。

## D25. 电池电量：实测分压标定 + 放电曲线表 + 插线冻结（2026-11-03）

- 动机：线性折算长期显示 11%，且 3.8V 显示 100%。万用表实测定位两个根因：
  分压实为 1:2.195（非假设 ÷2，R19/R20 非等值），固件少算 9%；插线时分压上游节点
  被抬到 ~5.4V（充电路径所致），读数直接钳满 100%。
- 标定：`BATTERY_DIVIDER_RATIO = 2.195`（3.76V→GPIO3 1.713V 单点标定，含 ADC 系统误差）；
  放电曲线 `BATTERY_CURVE` 分段线性插值替代直线，贴合锂电 S 形平台期。
- 锚点：0% = 3.00V（实测力竭 2.865V），满电 4.20V 对应 TP4054 CV；低电阈值 15% ≈ 3.58V，
  与模块 LDO 欠压区入口（电池 <~3.6V，经肖特基 PD1 + ME6217 两级压降）对齐。
- 插线（USB 模式）冻结电量更新，仅电池模式读数有效；采样 8 次去极值取平均。
- 边界：电压法在 3.7-3.9V 平台期天然粗糙（±10% 量级），不追求库仑计精度；
  精确方案预留硬件电量计（U9 未贴片焊盘，SDA/SCL→IO41/16）。
- **2026-11-03 修订（0.5.3）**：实测 3.8V 蓝牙连接显示 100% 定位为上报链缺陷，非测量问题——
  BAS 初始硬编码 100 + 上电 60s 上报空窗 + `setBatteryLevel` 默认 notify=false 静默写入，
  Windows 连接时读到占位值后不再轮询。修复：`updateBleBattery` 上电即首发 + notify=true。
- **2026-11-03 二次修订（0.5.4）**：实测"插充电头显示 100%"根因＝充电头不触发 USB 枚举，
  冻结逻辑（按 USB transport 判定充电）从未生效，采样持续读到被抬高的节点。按"简单优先"定案：
  撤销冻结机制，充电中读数偏高甚至 100% 属接受行为（冻结会让用户误以为充电无效，比 100% 更糟）；
  采样周期 30s→5s + BLE 值变化即报（无变化 60s 心跳），拔线后 ≤5s 恢复真值。
- **2026-11-05 三次修订（0.5.10）**：变化即报把边界抖动实时放大到系统 UI（5/6/5 反复，
  Windows 低电提示连弹）。消抖两层：电压域 EMA（α=0.35，噪声先衰减再进曲线）+ 电量域
  连续 2 次一致才提交（同 KEY_DEBOUNCE_TICKS 习惯，开机首测直接采纳不走确认）。
  否决放电棘轮（只降不升）：一次噪声探底会永久锁低，无恢复路径。
- **2026-11-05 四次修订（0.5.11）**：低电红灯阈值 15%→5%（≈3.43V），与 Windows 5% 低电
  提示对齐。注意代价：不再与模块 LDO 欠压区入口（~3.6V）对齐，红灯亮起时 ESP32 已在
  欠压区运行，剩余续航仅尾段数小时——按用户取舍，一致性优先。

## D26. RGB 三模式：默认 reactive，按下保持、松开渐隐（2026-11-05）

- 无存量用户，允许重定义原 `rgbMode=0`：固定为 `0=reactive`（默认、省电）/ `1=breath` /
  `2=follow`（原常亮行为）。记录仍为 150B v1，byte 11 直接承载模式；旧零值记录自然变为 reactive。
- reactive 仅映射 K1–K12 ↔ LED3–14：按下立即全亮，按住期间保持，松开后 500ms 线性渐隐；
  重复按下重新全亮。无动作映射的键也有反馈，旋钮/滚轮按压与 SideKey 无专属灯，不参与。
- breath 使用主题色，3 秒三角波周期、12.5%–100% 级别亮度；follow 保持原常亮。动画由
  LedController 的 20ms tick 驱动，无变化不写 WS2812；LED0 预设、LED1 连接、LED2 电量职责不变。
- 不按 USB/BLE 改模式；省电来自按键灯空闲熄灭，整机续航提升须实测，不作量化承诺。
- 首版编辑器只提供三模式选择并随预设写入；LED_PREVIEW 继续返回 NOT_IMPLEMENTED，不做实时硬件预览。
- 固件版本升至 0.5.5；协议与 record 版本不变。代码与自动化测试完成后仍需真机验收灯效和功耗。
- 2026-11-05 修订（0.5.6）：reactive 中文名定为“按键响应”；breath 完整周期 3s→6s，
  明暗各约 3 秒，亮度范围不变，使节奏更轻柔舒缓。
- 2026-11-05 修订（0.5.7）：breath 的线性三角波改为整数 smoothstep `x²(3−2x)`，
  端点变化速度趋近于零；6 秒周期与亮度范围不变，不增加固定顶点停顿。
- 2026-11-05 修订（0.5.8）：实机认可 smoothstep 后，将 breath 完整周期 6s→8s，
  明暗各约 4 秒；曲线与亮度范围不变。
- 2026-11-05 修订（0.5.9）：breath 保留 8 秒 smoothstep 明暗变化，在最暗端增加
  500ms 保持，完整周期 8.5 秒；最亮端不停顿，亮度范围不变。
- 2026-11-05 修订（0.5.12）：最亮端也增加 500ms 保持，完整周期 9 秒。
  同一发布包含 0.5.10 的电池 EMA/连续确认与 0.5.11 的 5% 低电阈值修改。
- 2026-11-05 修订（0.5.13）：启动早期偶发 K10 按下错亮 K12，松开渐隐仍归 K10，
  说明键位状态正确而单帧显示可能异常；按住期间原本不重发会让错帧持续。reactive 在按下
  50ms 后重发一次相同帧，松开或切预设取消确认，空闲仍不刷新。硬件错帧根因未由波形确认。
  用户实机确认问题消失；补丁局部、无持续开销，保留。
- 2026-11-05 修订（0.5.14）：新增 `3=colorCycle`（全体同步循环色相）与
  `4=rainbowFlow`（彩虹流动），两者忽略 accent。共用 16 秒色相周期；彩虹按物理外缘
  K1→K2→K3→K4→K5→K6→K7→K12→K11→K10→K8→K9 分布偏移，再映射实际 LED，
  不改变 Btn 枚举或灯链地址。LED_PREVIEW 仍不实现。
- 2026-11-05 修订（0.5.15）：实机观察原 rainbowFlow 为逆时针，将物理位置偏移由加改为减，
  反转为顺时针流动；顺序表、16 秒周期与 colorCycle 不变。
- 2026-11-05 修订（0.5.16）：新增 `5=reactiveRandom`（每键独立随机色相，按住固定、
  松开同色渐隐）与 `6=breathRandom`（每轮呼吸随机色相，曲线不变），均忽略 accent。
  新增 `7=marquee`：主题色顺时针流动，1 颗全亮头 + 55%/25%/10% 三级拖尾，其余熄灭；
  每键 100ms，使用位置间插值平滑移动，复用彩虹物理外缘表。
- 2026-11-05 修订（0.5.17）：breath/breathRandom 最低级别 32→0，暗端真正熄灭，
  随机色切换不再有可视跳变。marquee 每键 300ms（整圈 3.6s）。
  新增 `8=rainbowMarquee`：暗底亮斑与三级拖尾持续循环色相，同一键每圈颜色不同。
- 2026-11-05 修订（0.5.18）：两种 marquee 每键 900ms（整圈 10.8s），拖尾由三级
  55%/25%/10% 增为四级 55%/25%/10%/5%。
- 2026-11-05 修订（0.5.19）：两种 marquee 每键 1200ms（整圈 14.4s），拖尾不变。
- 2026-11-05 修订（0.5.20）：两种 marquee 的位置间亮度插值由线性改为 smoothstep，
  亮起与熄灭端点速度趋近于零；整圈时长不变。
- 2026-11-05 修订（0.5.21）：实机发现固定拖尾档位与端点缓动造成台阶和迟滞感，
  改为 1/256 键位精度的连续头部位置 + 连续二次衰减，取消亮度表；整圈 14.4 秒不变。
- 2026-11-05 修订（0.5.22）：二次衰减仅覆盖亮头后方，导致亮头到达时 0→255 突亮；
  增加前方一个键位的渐入曲线，并与后方拖尾取最大亮度，形成连续升起/衰减。
- 2026-11-05 修订（0.5.23）：拖尾由四键缩为三键，连续二次曲线锚点约为
  56%/25%/6%，整圈 14.4 秒与渐入衔接不变。

## D27. 固件版本独立头文件，避免版本递增触发全量重建（2026-11-05）

- 旧 `NAVIO_CHRON_FW_VERSION` 位于全局 `build_flags`，但只有 ConfigProto HELLO 使用。
  每次递增都改变 PlatformIO 构建指纹，五个环境的 NimBLE/TinyUSB/SDFat/Arduino 框架全部重编译，
  是日常迭代约 15 分钟的主因。
- 改为 `src/Version.h` 单一事实源，仅 `ConfigProto.cpp` 引用；`make_release.py` 同步从该文件
  读取版本。以后版本递增只需重编译 ConfigProto 并重新链接，HELLO 与 manifest 不会分叉。
- 首次迁移仍会全量构建一次，不清理 `.pio` 缓存；后续用构建日志验证增量效果。

## D28. Web 产品化：编辑器首页、独立更新工作区与专用 SVG（2026-11-06）

- 产品采用一个外壳、两个工作区：`/` 为高频预设编辑器，`/firmware/` 为独立固件更新，
  `/editor/` 保留兼容跳转。不把刷写与编辑状态机合并成单一页面。
- 视觉采用克制的新拟物控制台：统一浅灰材质、左上双阴影、凸起可操作、凹陷激活/输入；
  不使用实物位图叠加透明热点。专用 SVG 的形状即交互区域，并保留 Navio 物理识别关系。
- 原型检查点为 `b527f09`。阶段 1 落地共享视觉、SVG、导航与 Pages 路由；
  原型完成不等于真机验收，各正式阶段分别验证后再记录状态。
- 阶段 2 将更新页组织为连接→确认→更新→完成，发布清单与日志归入高级选项，救援使用四步指导；
  写入中阻止工作区离开并提供 beforeunload。模拟 HID 已覆盖确认、取消、最新与救援。
- 阶段 3 正式编辑器采用单套显式编辑会话，官方/键盘复制与安装关系分离；我的预设只保存到浏览器，
  键盘预设就地写回并验证，重复安装默认更新上次目标。页面不暴露批量写入；断线保留当前编辑内容。
- 阶段 4 补齐链接焦点、对话框名称与弹窗内错误，修正窄屏顺序和溢出；线上及真机 WebHID 验收通过。
- 独立审查后明确：单项安装不得用裸 presetId 推断历史关联，只有 `_installedId` 才允许默认更新；
  写入失败必须回到可重试状态，清单变更必须废止旧确认。共享 CSS/JS 修改须同步递增资源版本号。
- Config Protocol v2、150B 记录、OTA/ROM 与写入确认规则不因该视觉和路由决策改变。

## D29. 只做 Web 灯效预览，不开发硬件 LED_PREVIEW（2026-11-07）

- 用户选择灯效并写入设备后即可立即观察真实效果，恢复前项也只需再次选择写入，操作门槛低且风险低；
  硬件预览命令没有产品价值，明确不开发，不扩展协议或固件版本。
- `editor/rgb_preview.js` 用纯 JS 复现九种模式的时间曲线、外缘顺序与拖尾；选择卡片改为分组动画缩略图，
  中央 SVG 支持动画、按键触发、播放/暂停、重播、变速、重新随机与减少动态效果。
- 网页预览与硬件写入严格分离，不调用 WebHID、不宣称实时设备状态；随机模式使用可复现种子并做时间点测试。

## D30. 新增关闭模式，RGB 枚举按类别重排（2026-11-07）

- 新增 `0=off`：K1–K12 按键灯全部熄灭，LED0–LED2 状态灯职责不变。
  出厂预设、新建预设、官方模板与网页引擎默认使用 `1=reactive`，延续 D26 的默认省电反馈；
  off 由用户主动选择，不作为默认。
- 当前无存量用户，明确不保持旧灯效枚举或旧记录行为兼容。byte 11 固定为
  `0=off` / `1=reactive` / `2=reactiveRandom` / `3=follow` / `4=breath` /
  `5=breathRandom` / `6=colorCycle` / `7=rainbowFlow` / `8=marquee` / `9=rainbowMarquee`，
  与 Web 的“基础 / 按键触发 / 整体变化 / 流动拖尾”分组一致。
- 记录仍为 150B v1，协议仍为 v2，不新增命令；固件、Web 编解码、官方模板与预览引擎同步使用新枚举。
  off 的网页卡片与中央 SVG 均保持按键灯熄灭。固件版本升至 0.5.26，真机默认响应、关闭模式与状态灯行为待验收。

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
