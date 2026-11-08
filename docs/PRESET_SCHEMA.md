# Navio 二进制预设 Schema v1

> 状态：规范冻结（2026-10-27）；2026-11-02 修订 byte 13 为平台元数据（D24）；
> 2026-11-05 启用 byte 11 三种灯效（D26）；2026-11-07 新增 off、重排枚举并默认 reactive（D30），记录版本保持 1。
> 实现与实测状态见 `docs/PROJECT.md`。
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
| 11 | 1 | `rgbMode` | D30：`0=off` / `1=reactive`（默认）/ `2=reactiveRandom` / `3=follow` / `4=breath` / `5=breathRandom` / `6=colorCycle` / `7=rainbowFlow` / `8=marquee` / `9=rainbowMarquee`；其他值非法 |
| 12 | 1 | `reserved` | 必须为 0（应急保留） |
| 13 | 1 | `platform` | D24：`0=win`（历史记录天然值）/ `1=mac` / `2=iPad`；编辑器拒绝未知值，固件不校验语义、不据此分支，仅原样存取（D13 精化：平台是记录携带的呈现元数据） |
| 14 | 24 | `name` | UTF-8，前 nameLength 字节有效，其余补零 |
| 38 | 110 | `actions` | 22 个 5B 动作，见下节 |
| 148 | 2 | `recordCrc16` | 对前 148B 计算 CRC-16/CCITT-FALSE |

运行时使用 `name[24]` 保存名称并保证 NUL 终止，`Preset.name` 必须指向该自有缓冲区。
名称不能为空，前 nameLength 字节内不得出现 NUL；实现拒绝非法 UTF-8，不把 UTF-8
字节数等同于显示字符数。

扩展策略：`platform` 与 `rgbMode` 各占整字节；真需要更多字段时优先升级 record 版本
（offset 2 已预留），其次才是把 byte 12 与相邻字段做位打包（如
`[rgbMode:4][platform:4]`）——仅作为字节耗尽时的应急方案，不提前使用。

## 3. 动作（每个 5B）

槽位顺序固定为固件枚举顺序，不按矩阵扫描顺序或外观位置猜测：

- `actions[0..15]` 按 `Btn`：K1..K12、EncCenterPress、EncLargePress、WheelPress、
  SideKey（固定 index=15，占位）。
- `actions[16..21]` 按 `Enc`：Center、Large、Wheel；每个先 `dir=+1`，后 `dir=-1`。

```text
[kind][mods][codeLo][codeHi][wheelDy]
```

- `mods` 按 HID 修饰键位定义：bit0=LCTRL、bit1=LSHIFT、bit2=LALT、bit3=LGUI、
  bit4=RCTRL、bit5=RSHIFT、bit6=RALT、bit7=RGUI，与 `HidUsage.h` 的 MOD_ 常量一致。
- `wheelDy` 为 int8_t 有符号格数，符号表示滚轮方向，每个触发事件执行一次。
- `kind=0 None`：其余四字节必须为 0。
- `kind=1 KeyChord`：`code` 为键盘 Usage ID，允许 0（仅修饰键），最大 `0xE7`；
  `wheelDy=0`。`code=0 && mods=0` 非法，空动作必须使用 kind=0。
- `kind=2 Consumer`：`code` 为 `0x0001..0x03FF`，`mods=0`、`wheelDy=0`；
  上限与固件现有 Consumer 描述符及 `HidUsage.h` 支持范围一致。
- `kind=3 Wheel`：`code=0`、`wheelDy!=0`，`mods` 可为任意 8 位掩码；按钮动作不允许 Wheel。
- 其他 kind 或字段组合均非法。SideKey 在固件中仍为全局保留，映射值应使用 None。

## 4. 协议命令正文

- `GET_PRESETS`：空正文。响应以 `[count:1B][activeId:1B]` 开头，随后按当前顺序重复
  `[id:1B][nameLength:1B][name:nameLength 字节]`。名称无补零，数组顺序就是显示顺序。
- `READ_PRESET`：请求 `[id]`；响应为完整 150B 记录。
- `WRITE_PRESET`：请求为完整 150B 记录；全部协议与 schema 校验通过后才允许提交。
- `DELETE`：请求 `[id]`。
- `MOVE`：请求 `[id][beforeId]`；把 id 移到 beforeId 前，`beforeId=0` 表示末尾。
- `LED_PREVIEW`：请求 `[accentR][accentG][accentB][rgbMode]`，仅改灯不落盘；
  该命令保留，当前固件始终返回 `ERR_NOT_IMPLEMENTED`，与预设记录已支持的 rgbMode 无关。

大小响应、分片与错误恢复沿用 `PROTOCOL.md`。错误归属固定为：

- 未知 record 版本：`ERR_UNSUPPORTED_VERSION`；非法字段/未知 ID：`ERR_BAD_PAYLOAD`。
- 已满 6 套且 WRITE 新 ID：`ERR_OVERFLOW`。
- 删除最后一套：`ERR_BAD_STATE`；MOVE 的 beforeId 不存在：`ERR_BAD_PAYLOAD`。

## 5. NVS 键与双 manifest

所有键都位于现有 `navio` namespace，与旧 `preset` 键共用，不另建命名空间。

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

启动时分别校验两槽，以有符号 generation 差值选择更新的有效槽；若其引用记录加载失败，
再尝试另一有效槽，两槽均不可加载才回退出厂。后续提交基于已见最高 generation，
避免残留的高代次坏槽遮蔽新提交。

## 6. 原子提交与回退

1. 新记录先写 `p_XX` 并检查完整写入长度；删除/换序不增加记录。
2. 更新后的 manifest 写入另一槽并检查完整长度；只有完整落盘后才替换运行时安装列表。
3. 中断留下的未引用记录无害，旧 manifest 仍决定可见状态；同 ID 后续写入可覆盖。
4. 出厂 ID 缺少 NVS 记录时允许使用编译期出厂数据；同 ID 有记录则必须校验并使用动态版本。
   DELETE 则是从 manifest 移除该 ID，不保留引用，因此不会使编译期出厂版复活。
5. 自定义记录缺失/损坏，或任何被引用记录损坏：当前 manifest 不可加载，不加载半套状态；
   启动时先尝试另一有效槽，两槽均失败才回退出厂。
6. NVS 初始化、读取、写入及长度错误均返回 `ERR_NVS_FAILURE`，不改变运行时或旧 manifest。
7. 覆盖当前 activeId 时，提交后新记录立即生效；变更期间暂停 HID 并清理动作快照，
   完成后刷新 LED，再恢复正常输入。
