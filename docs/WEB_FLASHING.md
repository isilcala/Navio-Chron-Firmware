# Navio Web 统一刷写方案

> 状态：方案已冻结（2026-10-29，评审通过）；ROM 单路径探针已实测通过，统一入口尚未实现。
> 目标是用尽量低的复杂度覆盖普通用户最常见的刷写场景，不追求任意固件 100% 免 BOOT。

## 1. 目标与甜点位置

普通用户只需要插 USB、打开网页、确认升级，不需要安装 PlatformIO/esptool，也不需要先理解
BOOT、ROM、原生固件与 Navio 自定义固件的区别。

只自动覆盖：

1. **已有 Navio 自定义固件且支持 OTA**：走现有 WebHID 双槽升级。
2. **明确支持的演示固件**：按其实现的自动复位约定进入 ROM 下载，再走 Web Serial 完整刷写。
3. **已经处于 ROM 下载状态的 ESP32-S3**：若 Web Serial 可直接连接，也允许走同一完整刷写路径。

其他情况不强求自动化，统一退到一次 BOOT 救援。不会对未知固件枚举、猜测或尝试各种复位序列。

## 2. 三条路径

### A. Navio OTA（首选）

复用当前已经验收的能力，不新增线上协议：

```text
WebHID HELLO/GET_INFO
  → 确认 Navio 与 OTA 命令集
  → OTA_BEGIN / WRITE / FINISH
  → 重启
  → 本地自检自动 VALID
  → 网页读取版本与预设，显示成功
```

特点：只写另一 app 槽、SHA-256、自动回退、无需 BOOT、通常约 45–60 秒。

### B. 演示固件自动复位 + ROM 完整刷写

首版不为演示固件自定义 reset profile，优先使用 esptool-js 内置的
ClassicReset / UsbJtagSerialReset / HardReset 自动选择；只有实测证明出货固件需要特殊序列时，
才按需增加一个 CustomReset 备用 profile：

```text
识别支持的演示固件
  → 使用 esptool-js 内置复位策略进入 ROM 下载
  → 等待 ROM 下载器枚举
  → esptool-js 连接并确认 ESP32-S3（chipName）
  → 写入四个应用启动文件
  → 复位
  → 用 Navio HELLO 验证
```

不为“可能兼容”增加猜测逻辑。ROM VID/PID、复位方式和重连超时以实机结果为准，不凭经验硬编码。
实测 esptool-js 0.7.0 在原生 USB OTG 路径的刷后 `HardReset` 只拉低 RTS，没有产生 EN 复位脉冲；
ROM 探针因此刷后显式保持 DTR=false、拉高 RTS 100ms 再释放。此修订只处理刷后启动，不改变
进入 ROM 时使用内置复位策略的决策。

### C. BOOT 救援（统一兜底）

以下情况停止自动尝试，显示一次明确指导：

- 设备身份无法识别；
- 演示固件没有受支持的自动复位约定；
- ROM 连接、复位或重连失败；
- 刷写后无法通过 Navio HELLO 验证。

用户只需按提示“按住 BOOT 插 USB”后继续同一网页流程，不需要安装其他工具。救援不是失败惩罚，
而是统一状态机中的正常分支。

## 3. 用户流程与状态机

网页只呈现一个“连接并升级”入口：

```text
空闲
→ 检查设备
→ 选择 Navio OTA 或 ROM 路径
→ 用户确认版本与写入行为
→ 传输并显示进度
→ 自动重启/必要时重新选择设备
→ 验证 HELLO 与预设
→ 完成或进入 BOOT 救援
```

界面不展示协议名、分区名或“原生/自定义”分类。诊断日志可以折叠提供，但默认文案只说：

- 正在检查设备；
- 正在升级；
- 正在重新连接；
- 升级完成；
- 需要一次救援刷写。

浏览器重新授权是允许的用户动作，不把它当成技术错误。

## 4. 固件发布包与 manifest

静态 HTTPS 托管，无需自建后端。发布时由一个 manifest 同时服务 OTA 与 ROM 路径：

```json
{
  "schema": 1,
  "product": "navio-chron",
  "version": "0.4.0-dev",
  "channel": "dev",
  "chip": "esp32s3",
  "hid": {"vendorId": "0xCAFE", "productId": "0xBEEF", "usagePage": "0xFF00", "usage": 1},
  "flash": {"size": "4MB", "mode": "dio", "freq": "80m"},
  "images": [
    {"file": "bootloader.bin", "address": 0, "sha256": "..."},
    {"file": "partitions.bin", "address": 32768, "sha256": "..."},
    {"file": "boot_app0.bin", "address": 57344, "sha256": "..."},
    {"file": "firmware.bin", "address": 65536, "sha256": "..."}
  ]
}
```

约束：

- `firmware.bin` 同时是 Navio OTA 的应用镜像；ROM 路径使用全部四个文件。
- 每个文件下载后先核对 SHA-256，再开始写入；地址由 manifest 决定，不由用户填写。
- `tools/make_release.py` 从构建产物的 bootloader 镜像头推导 flash size/mode/freq，并生成地址和摘要，
  不允许手工维护一份可能漂移的副本。当前实测产物为 DIO、80MHz、4MB。
- manifest.hid 是路径 A 的 WebHID 过滤器单一事实源，页面不得另写一套 VID/PID/usage 常量。
- 版本按 SemVer 比较；stable 只提示更高版本，dev 允许同版本重装和显式降级，不自动降级。
- NVS 是否清理由设备身份而非路径决定：HID VID/PID 与 manifest.hid 匹配时，即使 HELLO 失败或
  无 OTA 命令集也视为 Navio，ROM 路径仍 `eraseAll=false` 并保留预设；只能取得 Web Serial、
  无法确认身份时默认 `eraseAll=true` 获得干净起点，但必须在确认页明确告知“将擦除设备数据”。
  后续可实测仅擦 NVS 区域的优化，不作为首版依赖。
- manifest、图片和页面必须满足 HTTPS/CORS；第三方依赖固定版本并记录来源与许可证。

首版不把签名作为伪装成已有能力的卖点；公开分发前另评审发布签名与信任链。

## 5. 浏览器与依赖边界

- 桌面 Chrome / Edge，HTTPS 页面。
- Navio OTA 只需要 WebHID；完整 ROM 路径同时需要 Web Serial。
- ROM 使用乐鑫官方 `esptool-js`（Apache-2.0，bundle 内联 pako），不自行实现 ESP ROM 下载协议。
  固定版本自托管 bundle 并记录 SRI/完整性摘要，不在运行时从 CDN 拉取。
- 不要求 PIO、Python、esptool、驱动安装说明或本地 Node 服务。
- 首版不支持 Firefox/Safari、BLE OTA、在线升级 bootloader/分区表或任意芯片型号；
  除上述身份规则外，不提供用户可选的整片擦除功能。

## 6. 错误与恢复规则

- Navio HELLO 失败：HID VID/PID 匹配仍按 Navio 保留 NVS；但无 CDC 的当前固件通常无法直接
  进入 ROM，允许短暂尝试后以 BOOT 救援结束，不在串口上反复重试。
- 自动复位失败：不循环重启设备，进入 BOOT 救援。
- ROM 连接成功但 chipName 不是 ESP32-S3：停止，不写任何数据。
- 镜像下载或 SHA-256 不符：停止，不写任何数据。
- 写入中断：允许重新执行同一路径；OTA 依靠双槽，ROM 使用 ROM 下载器重新刷写。
- 刷写结束但 HELLO 失败：不得显示成功，进入救援提示。
- 所有自动写入前必须有一次用户确认；无法确认身份且默认 eraseAll=true 时，确认页必须单独
  说明擦除范围，不得静默降级或清除用户数据。

## 7. 实施分层

### 第一步：ROM 单路径探针

- 固定版本引入 esptool-js。
- 扩展 `tools/make_release.py`，从构建配置与产物生成 manifest 和四件套，探针直接消费这些资产。
- 用 esptool-js 内置复位验证 ROM 完整刷写；仅实测需要时再增加 CustomReset。
- 验证刷后 Navio HELLO、输入和预设。

### 第二步：合并统一入口

- 复用现有 WebOTA，不另写 OTA 状态机。
- 增加设备检查、路径选择、统一进度、重连与救援文案。
- 保持无框架或最小依赖，不为了刷写页引入大型应用架构。

### 第三步：实测后扩大文案承诺

只有测试通过的设备/固件才写入“支持”。不把理论兼容写成用户承诺。

## 8. 验收矩阵

| 场景 | 预期 |
|---|---|
| 当前 Navio OTA 固件 | WebHID 免 BOOT，自动 VALID |
| 支持的演示固件 | 自动复位到 ROM，完整刷写后进入 Navio |
| 已在 ROM 下载状态的 ESP32-S3 | 直接完整刷写 |
| 不支持的演示固件 | 不盲目复位，进入 BOOT 救援 |
| 无有效应用但不在下载状态 | 尝试 ROM 连接，失败则 BOOT 救援 |
| 写入中断/浏览器关闭 | 不显示成功，可按原路径重试 |
| 错镜像、错芯片、错 SHA-256 | 写入前拒绝 |
| 刷写后 HELLO/预设异常 | 不显示成功，进入救援 |
| 已确认 HID 身份的现有 Navio 配置 | ROM/OTA 均不主动整片擦除，预设保持 |
| 只能取得 Web Serial 的未知设备 | 明确告知擦除范围并确认后，默认干净刷写 |

## 9. 冻结决策

1. 首版零自定义 reset profile；仅实测需要时增加一个 CustomReset 备用项。
2. 优先复用现有 OTA；ROM 路径只负责首次迁移和救援。
3. 静态 manifest + 四件套，不引入后端和本地代理。
4. 不对未知固件尝试 1200bps/DTR/RTS 猜测序列。
5. 将 BOOT 救援保留为正常、可理解的最后一步，不追求 100% 自动化。

## 10. 待讨论项

- 实际出货演示固件是否可被 esptool-js 内置复位覆盖，及其 USB 标识。
- manifest 托管位置及 stable/dev 通道规则。
- 是否同时提供本地四件套/ZIP 导入作为离线救援。
