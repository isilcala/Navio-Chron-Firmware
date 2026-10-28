# Navio 二进制预设 Schema v1

> 状态：规范冻结（2026-10-27）；实现与实测状态见 `docs/PROJECT.md`。
> 线上协议见 `PROTOCOL.md`。多字节整数均为 little-endian，禁止直接序列化 C++ 对象或依赖 padding。

## 1. 身份与数量

- `presetId` 为 1..255 的稳定身份，0 非法；数组索引只表示当前顺序。
- 最多安装 6 套，至少保留 1 套，禁止删除最后一套。
- 出厂预设按 `kPresets` 顺序使用 ID 1..4，允许被同 ID 的动态记录覆盖。
- 活动预设持久化 `activeId`，不持久化数组索引。

## 2. 单套记录（150B）

| 偏移 | 长度 | 字段 | 规则 |
|---:|---:|---|---|
| 0 | 2 | `magic` | 固定 `'N','P'`（`0x4E 0x50`） |
| 2 | 1 | `record` | 固定 1 |
| 3 | 1 | `flags` | v1 保留，必须为 0 |
| 4 | 2 | `totalLength` | 固定 150 |
| 6 | 1 | `presetId` | 1..255 |
| 7 | 1 | `nameLength` | 1..23B |
| 8 | 3 | `accent` | RGB 三字节 |
| 11 | 1 | `rgbMode` | v1 仅允许 `0=follow` |
| 12 | 2 | `reserved` | 必须为 0 |
| 14 | 24 | `name` | UTF-8，前 nameLength 字节有效，其余补零 |
| 38 | 110 | `actions` | 22 个 5B 动作，见下节 |
| 148 | 2 | `recordCrc16` | 对前 148B 计算 CRC-16/CCITT-FALSE |

运行时使用 `name[24]` 保存名称并保证 NUL 终止，`Preset.name` 必须指向该自有缓冲区。
名称不能为空或包含 NUL；实现拒绝非法 UTF-8，不把 UTF-8 字节数等同于显示字符数。

## 3. 动作（每个 5B）

顺序为 16 个矩阵按键（含 SideKey 占位），随后 3 个编码器各 2 个方向：

```text
[kind][mods][codeLo][codeHi][wheelDy]
```

- `kind=0 None`：其余四字节必须为 0。
- `kind=1 KeyChord`：`code` 为键盘 Usage ID，允许 0（仅修饰键），最大 `0xE7`；`wheelDy=0`。
- `kind=2 Consumer`：`code` 为 `0x0001..0x03FF`，`mods=0`、`wheelDy=0`。
- `kind=3 Wheel`：`code=0`、`wheelDy!=0`，`mods` 可为任意 8 位掩码；按钮动作不允许 Wheel。
- 其他 kind 或字段组合均非法。SideKey 在固件中仍为全局保留，映射值应使用 None。

## 4. 协议命令正文

- `GET_PRESETS`：空正文。响应为 `count`，随后按当前顺序重复 `[id][nameLength][name]`。
- `READ_PRESET`：请求 `[id]`；响应为完整 150B 记录。
- `WRITE_PRESET`：请求为完整 150B 记录；全部协议与 schema 校验通过后才允许提交。
- `DELETE`：请求 `[id]`。
- `MOVE`：请求 `[id][beforeId]`；把 id 移到 beforeId 前，`beforeId=0` 表示末尾。

大小响应、分片与错误恢复沿用 `PROTOCOL.md`。未知 record 版本返回
`ERR_UNSUPPORTED_VERSION`，非法字段返回 `ERR_BAD_PAYLOAD`。

## 5. NVS 键与双 manifest

- `p_XX`：两位大写十六进制 presetId 对应的 150B 记录。
- `manifest_0` / `manifest_1`：18B 双槽清单。
- 旧 `preset` 键只在无有效 manifest 时选择出厂 activeId，不再承担动态身份。

Manifest 布局：

| 偏移 | 长度 | 字段 |
|---:|---:|---|
| 0 | 2 | `magic = 'N','M'` |
| 2 | 1 | `manifestVersion = 1` |
| 3 | 1 | `count`，1..6 |
| 4 | 1 | `activeId`，必须出现在 ids 中 |
| 5 | 1 | 保留，必须为 0 |
| 6 | 4 | `generation:u32` |
| 10 | 6 | `ids[6]`，前 count 项唯一且非零，其余补零 |
| 16 | 2 | `manifestCrc16`，对前 16B 计算 |

启动时分别校验两槽，以有符号 generation 差值选择更新的有效槽。无有效槽时回退出厂。

## 6. 原子提交与回退

1. 新记录先写 `p_XX` 并检查完整写入长度；删除/换序不增加记录。
2. 更新后的 manifest 写入另一槽并检查完整长度；只有完整落盘后才替换运行时安装列表。
3. 中断留下的未引用记录无害，旧 manifest 仍决定可见状态；同 ID 后续写入可覆盖。
4. 出厂 ID 缺少 NVS 记录时允许使用编译期出厂数据；同 ID 有记录则必须校验并使用动态版本。
5. 自定义记录缺失/损坏，或任何被引用记录损坏：整个 manifest 无效并回退出厂，不加载半套状态。
6. NVS 初始化、读取、写入及长度错误均返回 `ERR_NVS_FAILURE`，不改变运行时或旧 manifest。
7. 变更期间暂停 HID 并清理动作快照；完成后刷新 LED，再恢复正常输入。
