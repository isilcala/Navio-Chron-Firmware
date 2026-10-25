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
