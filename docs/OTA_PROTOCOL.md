# Navio OTA Protocol v1

> 状态：已冻结（2026-10-29，评审通过），尚未实现。
> 本文是 `PROTOCOL.md` 的 OTA 扩展；线上帧、分片、重传、ACK/ERR 与 CRC 规则沿用该文件。
> 实现完成并通过 §11 验收门槛后才可标记已实现；文档状态不得超前于代码。

## 1. 目标与范围

- 首版通过现有 USB Vendor HID 升级 ESP32-S3 应用固件，主机可为 hidapi 工具或 WebHID。
- 新镜像写入当前未运行的 OTA app 分区；完整校验通过前不改变启动选择。
- 支持镜像完整性校验、显式重启、首启动确认与失败恢复。
- 只升级应用 `firmware.bin`，不在线升级 bootloader、分区表、NVS 或文件系统。
- 首版不支持断点续传、BLE 配置通道、签名发布或安全版本防降级；这些不得被误称为已实现。

设计参考：

- [ESP-IDF OTA](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/ota.html)：
  双 app 分区、双扇区 `otadata`、验证后切换及首启动回退。
- [USB DFU 1.1](https://www.usb.org/sites/default/files/DFU_1.1.pdf)：显式块序号、逐块确认和
  manifestation 阶段；本项目复用其可靠性边界，不引入新的 USB DFU 类。
- [MCUboot](https://docs.mcuboot.com/design.html)：镜像验证与可确认/可回退的升级状态；
  本项目使用 ESP-IDF 对应机制，不采用 MCUboot 镜像格式。

## 2. 传输与常量

| 名称 | 值 |
|---|---:|
| 基础协议 | Config Protocol v2，`proto` 保持 2 |
| `OTA_BLOCK_MAX` | 2044B |
| 镜像摘要 | SHA-256，原始 32B |
| OTA 接收会话空闲超时 | 30000ms |
| BEGIN/FINISH 主机单帧等待 | 至少 10000ms，最多重试 2 次 |
| 重启前 ACK 留置时间 | 至少 250ms |

`OTA_WRITE` 正文为 4B offset 加最多 2044B 数据，因此仍满足 `BODY_MAX=2048` 和最多 36 片。
每个块只在 Flash 接受完整数据后返回最终 ACK；首版不需要滑动窗口。

BEGIN 包含同步分区擦除，FINISH 包含读回/镜像验证和 otadata 写入，二者不得沿用基础的 1000ms
主机超时；其他 OTA 命令仍沿用 1000ms/最多 3 次重试。主机必须按命令设置超时，不能用固定总时长
判断升级挂死。约 1MB 镜像约需 475 个块、每块最多 36 片，逐片停等的基线为数十秒级帧传输，
叠加 Flash 与 WebHID 事件开销后应按约 1–3 分钟的量级展示进度，实测后再收紧预期。

OTA 会话是跨命令的应用状态，不等同于 Config Protocol 的单消息分片事务。单消息重传仍由
`PROTOCOL.md` 的完整末帧缓存处理，不得重复写 Flash。

## 3. 命令注册

命令 ID 只追加，不复用；旧固件对这些 ID 返回 `ERR_NOT_IMPLEMENTED`。

| ID | 名称 | 用途 |
|---:|---|---|
| `0x0A` | `OTA_BEGIN` | 开始或重新开始镜像接收 |
| `0x0B` | `OTA_WRITE` | 按确切 offset 顺序写入一块 |
| `0x0C` | `OTA_FINISH` | 校验完整镜像并设置下一启动分区 |
| `0x0D` | `OTA_ABORT` | 中止尚未完成的接收会话 |
| `0x0E` | `OTA_STATUS` | 查询会话、进度、槽位和运行镜像状态 |
| `0x0F` | `OTA_REBOOT` | ACK 后重启到已激活镜像 |
| `0x10` | `OTA_CONFIRM` | 确认首启动镜像可用，取消自动回退 |

实现后，`GET_INFO.cmds` 必须追加十进制 10–16；未实现的固件不得提前上报这些能力。

## 4. 通用数据类型

多字节整数均为 little-endian。

槽位值：`0=app0/ota_0`，`1=app1/ota_1`，`0xFF=无或未知`。主机不得根据槽位推断绝对地址。

`runningImageState` 使用线上枚举，不直接暴露 ESP-IDF 的整数布局：

| 值 | 名称 | 含义 |
|---:|---|---|
| 0 | `UNKNOWN` | 状态不可取得 |
| 1 | `VALID` | 已确认，可长期启动 |
| 2 | `PENDING_VERIFY` | 首启动待确认，下一次未确认重启应回退 |
| 3 | `INVALID` | 已标记无效 |
| 4 | `ABORTED` | 未确认且已被启动器放弃 |
| 5 | `NEW` | 已激活但尚未发生首启动 |
| 6 | `UNDEFINED` | ESP-IDF 未记录状态，可按普通有效镜像处理 |

`esp_ota_get_state_partition` 返回 `ESP_ERR_NOT_FOUND`（例如 esptool 直刷后无状态记录）必须映射为
`UNDEFINED`；只有分区/API 调用本身失败才映射为 `UNKNOWN`，不得混用。

`updateError` 保留最近一次 Arduino `UpdateClass::getError()` 值；无错误为 0。新 `OTA_BEGIN`
清除旧错误。设备重启后该运行时错误不持久化。

## 5. 命令正文与响应

### 5.1 `OTA_BEGIN (0x0A)`

请求正文，36B：

```text
[imageSize:u32][imageSha256:32]
```

- `imageSize` 是完整应用 `firmware.bin` 字节数，必须大于 0 且不超过目标分区实际容量。
- `imageSha256` 对完整 imageSize 字节计算，是 32B 原始摘要，不是 ASCII 十六进制。
- 设备选择当前未运行的 OTA app 分区，执行 begin，并在任何写入前设置 SHA-256 校验。
- `IDLE` 时开始新会话；`RECEIVING` 时先中止旧会话再重新开始。
- `READY_TO_REBOOT` 或运行镜像为 `PENDING_VERIFY` 时返回 `ERR_BAD_STATE`。

成功 ACK data，4B：

```text
[targetSlot:u8][maxBlock:u16=2044][reserved:u8=0]
```

### 5.2 `OTA_WRITE (0x0B)`

请求正文：

```text
[offset:u32][data:1..2044B]
```

- 仅在 `RECEIVING` 且 `offset == received` 时接受。
- `offset + dataLength` 不得溢出 u32 或超过 imageSize。
- offset 不匹配返回 `ERR_BAD_SEQ`；主机随后用 `OTA_STATUS` 取得期望 received。
- 完整数据被 Update 接受后才返回成功；短写或 Flash 错误不得推进 received。

成功 ACK data，4B：

```text
[nextOffset:u32]  // 等于 offset + dataLength
```

### 5.3 `OTA_FINISH (0x0C)`

请求正文为空，仅允许在 `RECEIVING && received == imageSize` 时执行。

设备依次完成：

1. 完整长度与 SHA-256 校验；
2. ESP 应用镜像格式、目标芯片及配置启用的签名验证；
3. 写入 `otadata`，把目标槽设为下一启动分区；
4. 会话转为 `READY_TO_REBOOT`，不立即重启。

任一步失败均不得返回成功。SHA-256 在激活前校验；失败时不得激活镜像。

成功 ACK data，1B：`[targetSlot]`。

`FINISH` 成功后，`ABORT` 不能撤销启动选择；任何复位都可能进入新镜像，首启动确认机制负责回退。

### 5.4 `OTA_ABORT (0x0D)`

请求正文为空。

- `RECEIVING`：调用 abort、释放资源并转为 `IDLE`，返回空 ACK。
- `IDLE`：作为幂等操作返回空 ACK。
- `READY_TO_REBOOT`：返回 `ERR_BAD_STATE`，不得伪装成已撤销激活。

中止只丢弃运行时接收状态，不擦除或激活任何分区；残缺目标镜像不得在后续被当作有效镜像续写。

### 5.5 `OTA_STATUS (0x0E)`

请求正文为空，任何会话状态均可调用。成功 ACK data 固定 16B：

| 偏移 | 长度 | 字段 |
|---:|---:|---|
| 0 | 1 | `sessionState`：0=IDLE，1=RECEIVING，2=READY_TO_REBOOT |
| 1 | 1 | `updateError` |
| 2 | 1 | `targetSlot` |
| 3 | 1 | `runningSlot` |
| 4 | 4 | `imageSize:u32`；IDLE 时为 0 |
| 8 | 4 | `received:u32`；IDLE 时为 0 |
| 12 | 1 | `runningImageState` |
| 13 | 3 | 保留，必须为 0 |

`RECEIVING` 时 received 是下一块必须使用的 offset。`READY_TO_REBOOT` 时 received==imageSize。

### 5.6 `OTA_REBOOT (0x0F)`

请求正文为空，仅允许 `READY_TO_REBOOT`。

设备先返回空 ACK，至少留置 250ms 让 USB IN 报告发出，再调用重启。主机应关闭旧 HID 句柄，
等待重新枚举后用 HELLO/STATUS 验证，而不是把重启期间的断连当作写入失败。

### 5.7 `OTA_CONFIRM (0x10)`

请求正文为空。

- 运行镜像为 `PENDING_VERIFY`：执行首启动自检已通过的确认，转为 `VALID`。
- 已为 `VALID`：幂等返回成功，覆盖 ACK 丢失后的主机重试。
- 其他状态：返回 `ERR_BAD_STATE`。

成功 ACK data，1B：`[runningImageState=VALID]`。

主机只有在 HELLO、GET_INFO、GET_PRESETS 及基本输入链路符合预期后才发送 CONFIRM。运行镜像保持
`PENDING_VERIFY` 时不得开始下一次 OTA。

升级工具必须在同一升级会话内完成 REBOOT→重连验证→CONFIRM。工具退出后仍未确认的镜像，
在用户拔插或复位时自动回退是预期的安全行为，不是“升级丢失”故障；确认窗口故意不设超时，
也不做未经主机验证的固件自确认。纯 BLE 使用场景的确认策略留待 BLE OTA 阶段定义。

## 6. 会话约束与超时

- `RECEIVING` 时允许 HELLO、GET_INFO、OTA_STATUS、OTA_WRITE、OTA_FINISH、OTA_ABORT、OTA_BEGIN；
  其他配置/变更命令返回 `ERR_BAD_STATE`。
- `READY_TO_REBOOT` 时允许 HELLO、GET_INFO、OTA_STATUS、OTA_REBOOT；其他命令返回 `ERR_BAD_STATE`。
- READ_CHUNK 属于上述允许命令的大响应拉取机制，在 RECEIVING/READY 均允许，不视为新配置命令。
- 连续 30000ms 未收到合法 OTA 命令，`RECEIVING` 自动转为 IDLE 并释放 Update 资源，不发送异步 ERR。
- IDLE/READY 不使用该接收超时。设备复位会丢失接收会话，首版从头重写，不恢复残片。
- OTA 接收期间暂停普通 HID 输入和预设变更；状态 LED 可显示升级进度，但不得引入异步协议通知。

## 7. 错误归属

在 `PROTOCOL.md` 已有错误码上追加：

| ID | 名称 | 用途 |
|---:|---|---|
| 12 | `ERR_FLASH_FAILURE` | 分区、擦写、激活或确认失败；detail 保留 Update/阶段错误 |
| 13 | `ERR_IMAGE_INVALID` | ESP 应用镜像格式、目标芯片或签名验证失败 |

已有错误映射：

- `ERR_BAD_PAYLOAD`：正文布局错误、空数据块、保留字段非零。
- `ERR_OVERFLOW`：镜像超过目标分区、块超过 2044B、offset+长度越界。
- `ERR_BAD_SEQ`：OTA_WRITE offset 不等于 received；主机用 STATUS 重新同步。
- `ERR_BAD_STATE`：命令与会话/镜像状态不符，或接收期间调用非 OTA 变更命令。
- `ERR_CHECKSUM`：完整镜像 SHA-256 不匹配，detail 可携带 `UPDATE_ERROR_SHA256=15`。
- `ERR_FLASH_FAILURE` / `ERR_IMAGE_INVALID` 的 detail 用于诊断，主机不得仅根据 detail 推断成功。

首个 OTA_WRITE 就可能因镜像 magic 不是 0xE9 返回 `ERR_IMAGE_INVALID`，不得等到 FINISH 才报，
也不得把它当作可重试的 Flash 传输故障。`ERR_NVS_FAILURE` 不用于 OTA Flash 写入。
任何错误 ACK/ERR 丢失都按基础协议重传最终响应。

## 8. 复位、断电与回退语义

| 中断位置 | 必须结果 |
|---|---|
| BEGIN/WRITE 期间 | 当前启动选择不变；旧应用继续可启动，残片无效，下次从头开始 |
| ABORT 或接收超时 | 同 WRITE 中断，运行时资源释放 |
| FINISH 校验失败 | 不激活目标镜像，旧启动选择保持 |
| FINISH/otadata 写入期间 | 依赖 ESP-IDF 双扇区 otadata；启动器选择旧镜像或完整验证的新镜像，不选择半写入镜像 |
| 新镜像首启动前复位 | 新镜像仍未确认；按启动器 NEW/PENDING_VERIFY 规则处理 |
| 新镜像首启动崩溃或未确认后再次复位 | 启用自动回退后返回上一有效镜像 |
| CONFIRM 后 | 新镜像成为有效版本，后续正常启动 |

已静态确认当前 Arduino 包及 `qio_qspi` 变体的 sdkconfig 启用
`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`，且未启用 anti-rollback；仍必须上机实测首启动回退，
不得把静态配置或“应用内校验”冒充回退验收。
侧键 10 秒及 BOOT 插拔救援路径保留到上述测试全部通过之后。

## 9. 主机标准流程

1. HELLO/GET_INFO：确认设备、协议与 OTA 能力；STATUS 确认非 PENDING_VERIFY。
2. 读取应用 `firmware.bin`，计算长度和 SHA-256；不要把 bootloader、分区表或 merged 镜像拼入。
3. OTA_BEGIN，核对 targetSlot 和 maxBlock。
4. 从 offset 0 顺序 OTA_WRITE，等待每块最终 ACK；错误后用 STATUS 重新同步或显式 ABORT。
5. OTA_FINISH，确认 READY_TO_REBOOT；任何校验失败都不得重启到目标镜像。
6. OTA_REBOOT，等待重新枚举。
7. HELLO 核对新 fw；STATUS 核对 runningSlot/runningImageState，并做 GET_PRESETS 与基本输入检查。
8. 成功后 OTA_CONFIRM；若未确认，保留自动回退语义。

开发首版允许同版本与降级，便于 A/B 回归；主机应展示版本，不把 SHA-256 当作发布签名。

## 10. 安全与兼容性边界

- SHA-256 与帧 CRC 只提供完整性/错误检测，不证明镜像来源。
- 首版信任物理 USB 主机；公开分发或无线升级前需单独评审镜像签名、密钥与防降级策略。
- 应用 OTA 不写 NVS，既有预设、activeId、manifest 和 BLE 绑定必须保持。
- 新固件若不兼容旧 NVS schema，必须按既有版本规则拒绝或迁移，不得静默清除用户配置。
- 命令追加不提升 Config Protocol `proto`；能力发现以 GET_INFO.cmds 为准。

## 11. 验收门槛

- 正常 app0→app1、app1→app0 升级及连续重复升级。
- 实测并记录 BEGIN 擦除、FINISH 校验/激活及整包传输耗时，主机长超时与进度显示符合实测。
- 每块 ACK 丢失重传不重复推进 received，错 offset/乱序/超长/空块有确定错误。
- 错长度、错 SHA-256、非 ESP 应用镜像、错误目标镜像均不激活。
- BEGIN→ABORT、接收超时、RECEIVING 中重新开始、FINISH 前断连/断电均保留旧应用。
- FINISH 后重启进入新应用；HELLO/预设/BLE 绑定与输入正常后才能 CONFIRM。
- 首启动不确认及模拟启动失败可自动回退；CONFIRM 重试幂等。
- OTA 不改变 NVS 中用户预设和绑定；原 Config Protocol 与动态预设故障回归全部通过。
- 完整五环境构建、hidapi 与 WebHID 主机路径通过；救援烧录入口始终可用。
