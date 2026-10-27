# Navio Config Protocol v2

> 状态：规范冻结（2026-10-27）；固件与桌面端实现以本文件为准。
> 当前代码仍处实现阶段，文档中的“已冻结”不表示全部命令已经实现。

## 1. 范围与术语

- 通道：独立 Vendor HID，Usage Page `0xFF00`、Usage `0x01`。
- USB 线上报告：`Report ID 6 + 63B 数据`。Report ID 不属于本文的 63B 帧。
- 主机：桌面端、WebHID 页面或 hidapi 工具；设备：Navio Chron 固件。
- 多字节整数一律 little-endian。
- 同一方向同一时间只允许一个事务，不支持并发请求或异步通知。
- 第一版只实现 USB；未来 BLE 配置通道复用同一帧格式，不另创协议。

## 2. 常量

| 名称 | 值 |
|---|---:|
| `MAGIC` | `0x4E` |
| `FRAME_SIZE` | 63B |
| `FRAME_PAYLOAD_MAX` | 58B |
| `BODY_MAX` | 2048B |
| `FRAGMENT_MAX` | 36 |
| `MAX_PRESETS` | 6 |
| 设备事务空闲超时 | 3000ms |
| 主机单帧等待/重试建议 | 1000ms / 最多 3 次 |

`BODY_MAX=2048` 取代实现骨架中的 1024B 接收缓冲，理由是为单套二进制预设及后续
RGB 配置保留余量；固件使用固定缓冲，不进行运行时动态分配。

## 3. 63B 帧布局

| 偏移 | 长度 | 字段 | 说明 |
|---:|---:|---|---|
| 0 | 1 | `magic` | 固定 `0x4E` |
| 1 | 1 | `cmd` | 命令 ID |
| 2 | 1 | `seq` | 片号，从 0 开始；`READ_CHUNK` 响应复用为响应片号 |
| 3 | 1 | `total` | 总片数，从 1 开始 |
| 4 | 58 | `payload` | 分片内容，末片未用字节必须补零 |
| 62 | 1 | `crc8` | 对帧偏移 0..61（含补零）计算 |

普通消息的总片数在 frame 0 就必须满足：

```text
total == ceil((4 + bodyLength) / 58)
1 <= total <= 36
bodyLength <= 2048
```

`READ_CHUNK` 响应对应的大响应采用第 8 节的 55B 数据布局，其 `total` 按该节计算。

## 4. 普通消息头与 CRC

除 `READ_CHUNK` 响应外，请求和响应的 payload 拼接后均以以下 4B 开头：

| 长度 | 字段 | 说明 |
|---:|---|---|
| 2 | `bodyLength` | 正文字节数，不含此 4B 头 |
| 2 | `bodyCrc16` | 仅对正文计算，不含此 4B 头，不含帧补零 |

算法固定为：

- CRC8：CRC-8/SMBUS，poly `0x07`，init `0x00`，无反射，xorout `0x00`。
- CRC16：CRC-16/CCITT-FALSE，poly `0x1021`，init `0xFFFF`，无反射，xorout `0x0000`。
- ASCII `"123456789"` 的校验值分别为 `0xF4`、`0x29B1`。
- 空正文的 CRC16 为 `0xFFFF`。

CRC 只用于错误检测，不提供加密或身份认证。

## 5. 命令 ID

已发布的命令 ID 不得复用或插入重排；新增能力只能追加。

| ID | 名称 | 方向与用途 |
|---:|---|---|
| `0x01` | `HELLO` | 协议/固件版本与设备名 |
| `0x02` | `GET_INFO` | schema、正文上限、预设上限与命令能力 |
| `0x03` | `GET_PRESETS` | 预设清单（稳定 ID、顺序、名称） |
| `0x04` | `WRITE_PRESET` | 校验后原子写入一套预设 |
| `0x05` | `DELETE` | 按稳定 ID 删除 |
| `0x06` | `MOVE` | 按稳定 ID 调整顺序 |
| `0x07` | `LED_PREVIEW` | 灯光预览，不落盘 |
| `0x08` | `READ_PRESET` | 按稳定 ID 读取一套预设 |
| `0x09` | `READ_CHUNK` | 主机逐片拉取大响应 |
| `0x40` | `ACK` | 成功响应 |
| `0x41` | `ERR` | 错误响应 |

HELLO/GET_INFO 的 JSON 数据格式独立于预设二进制 schema。预设相关命令的正文布局由
后续 `PRESET_SCHEMA` 文档定义；未实现命令必须返回 `ERR_NOT_IMPLEMENTED`。

## 6. ACK / ERR 布局

ACK 正文固定以 3B 开头：

```text
[echoCmd][seq][status][optional data...]
```

- `echoCmd`：被回应的命令 ID。
- `seq`：被回应的片号。
- `status`：
  - `OK=0`：命令执行完成，或小响应已直接附带。
  - `CHUNK=1`：请求分片已接受，或本帧是 `READ_CHUNK` 数据片。
  - `MORE=2`：命令执行成功，大响应需通过 `READ_CHUNK` 拉取。

ERR 正文为：

```text
[echoCmd][seq][errorCode][detail]
```

`detail` 用于携带期望片号、失败阶段或命令特定原因；无细节时为 0。

## 7. 主机到设备：逐片确认

1. 主机发送第 `n` 片并等待响应，收到有效 ACK 后再发下一片。
2. 中间片成功时，设备回复 `ACK[echoCmd][n][CHUNK]`。
3. 最后一片收齐后，设备依次验证：
   - frame 0 声明的 `total`、正文长度和实际接收长度；
   - 整体 CRC16；
   - 命令正文与 schema。
4. 全部通过后才允许执行命令或写 NVS；最终回复 `OK`，需要大响应时回复 `MORE`。
5. 同一片重复到达时，设备重复确认但不得重复追加或重复执行。
6. 事务进行中收到跳变片号返回 `ERR_BAD_SEQ`，`detail=expectedSeq`。
7. 主机等待超时后可重发同一片，建议单帧最多重试 3 次；放弃时下一事务从 seq 0 开始。

设备只有在最后一片通过全部校验后才能产生副作用。任何错误都不得留下部分 NVS 写入。

## 8. 设备到主机：大响应拉取

### 8.1 小响应

若命令响应数据 `dataLength <= 51`，设备可在最终 ACK 中直接附带：

```text
[echoCmd][seq][OK][data...]
```

51B 的计算为：58B 帧 payload - 4B 普通消息头 - 3B ACK 头。

### 8.2 大响应

若 `dataLength > 51`，最终 ACK 不携带正文，而使用：

```text
[echoCmd][seq][MORE][dataLength:u16][dataCrc16:u16]
```

随后主机通过 `READ_CHUNK` 逐片拉取。`dataLength` 上限仍为 2048B。

`READ_CHUNK` 请求是普通单片消息，正文为：

```text
[chunkSeq]
```

设备返回 ACK 帧，其帧头 `seq=chunkSeq`，`total=chunkTotal`，正文为：

```text
[READ_CHUNK][chunkSeq][CHUNK][chunkData...]
```

每片 `chunkData` 最多 55B（58B payload - 3B ACK 头），因此：

```text
chunkTotal = ceil(dataLength / 55)
```

2048B 大响应对应最多 38 片；该上限只用于 READ_CHUNK，不套用普通消息的 36 片限制。

- `READ_CHUNK` 响应不另带 4B 普通消息头；`MORE` 已提供整体长度和 CRC16。
- 下一片请求兼作前一片的确认；重复请求必须重发同一片，不得推进游标。
- 主机收齐后按 `dataLength` 截去末片补零并验证 CRC16。
- 非法片号返回 `ERR_BAD_SEQ`，`detail` 为当前期望片号。
- `READ_CHUNK` 不会开始预设写入事务，也不会取消待读取的大响应。

## 9. 隐式取消、超时与恢复

- 除 `READ_CHUNK` 外，任何通过 magic/基本格式/CRC8 检查的 `seq=0` 命令都表示新事务：
  设备必须清空旧重组状态和旧待发送响应，再处理该帧。重复 seq 0 同样安全。
- `BAD_SEQ` 只用于活动事务中的跳变；非活动状态收到 `seq>0` 返回 `ERR_BAD_STATE`。
- 设备在 `poll()` 中检查事务时间：连续 3000ms 未收到合法片，清空接收事务和
  待发送响应。超时只清状态，不主动发送异步 ERR。
- 新 HELLO（seq 0）必须始终能放弃旧事务并恢复通道，禁止永久停留在 expectedSeq。
- 发送或接收队列丢帧依靠上述确认、重复请求和超时恢复，不得静默写入不完整正文。

## 10. 错误码

保留骨架已有编号，新增只追加：

| ID | 名称 | 含义 |
|---:|---|---|
| 0 | `ERR_NONE` | 无错误 |
| 1 | `ERR_BAD_MAGIC` | magic 错误 |
| 2 | `ERR_NOT_IMPLEMENTED` | 命令未实现 |
| 3 | `ERR_BAD_SEQ` | 片号或拉取顺序错误 |
| 4 | `ERR_OVERFLOW` | 正文或缓冲区超限 |
| 5 | `ERR_CHECKSUM` | CRC8/CRC16 不匹配 |
| 6 | `ERR_BAD_TOTAL` | total 与 bodyLength 不一致 |
| 7 | `ERR_TIMEOUT` | 主机侧事务超时（日志/桌面端使用） |
| 8 | `ERR_BAD_STATE` | 非活动事务收到后续片或拉取无响应 |
| 9 | `ERR_BAD_PAYLOAD` | 命令正文/schema 非法 |
| 10 | `ERR_NVS_FAILURE` | 持久化失败 |
| 11 | `ERR_UNSUPPORTED_VERSION` | 协议或 schema 版本不支持 |

## 11. 版本与预设交换格式

- 本文件对应 `proto=2`；旧的无 CRC 骨架为 `proto=1`，双方不得混用。
- 设备与 NVS 使用带版本和显式长度的二进制预设记录，不在固件中解析 JSON。
- `.navio.json` 是桌面端交换与社区分享格式，桌面端负责 JSON 校验、双向转换及版本降级。
- 新桌面端连接旧固件时可转换为旧记录布局；固件遇到不认识的记录版本只明确报错，
  不尝试猜测或部分解析。
- 预设使用稳定 ID 作为身份，数组索引只表示当前顺序；持久化活动预设同样保存稳定 ID。

## 12. 首版验收要求

- HELLO/GET_INFO 的小响应与大响应两条路径均通过 hidapi 和 WebHID。
- 重复片、乱序、缺片、错 CRC8、错 CRC16、错误 total、超长正文均返回确定结果。
- 任意中断后，新 seq 0 请求可在 3 秒内或直接恢复，不需要重插设备。
- 大响应重复拉取、乱序拉取和 CRC 校验行为确定。
- 在全部帧与 schema 校验通过前，NVS 内容保持不变。
