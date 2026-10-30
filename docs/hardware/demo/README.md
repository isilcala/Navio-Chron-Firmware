# SuperMini FastLED 演示固件备份

`fastled_full_4mb.bin` 是用户提供的全新 ESP32-S3 SuperMini 实机在 2026-10-29 读取的
完整 4MB Flash dump，不是从 `reference/` 上游源码构建或复制的文件。用于演示固件自动复位、
ROM 迁移及恢复测试。

- 大小：4194304 字节（0x400000）
- SHA-256：`a44ee2be5db4b60aa46bd496d096ab1b863a84203524e0a003547164daf3bf2a`
- 芯片：ESP32-S3FH4R2，4MB Flash + 2MB PSRAM
- Flash 参数：DIO / 80MHz / 4MB
- 应用：app0 为 FastLED 演示程序，app1 空白
- app0 构建信息：Arduino core 3.3.7，ESP-IDF 5.5.2，app version `8cabf2c`，
  编译时间 2026-02-11 19:50:46
- USB：`303A:1001`，USB-Serial/JTAG；运行中 `no_reset` 失败，`default_reset` 可进入 ROM

完整 dump 包含 bootloader、分区表、otadata、app0/app1、NVS、SPIFFS 和 coredump 区域。
分区布局与当前 Navio `default.csv` 相同。

读取命令（仅读取，不擦写）：

```bash
esptool --chip esp32s3 --port COMx --baud 460800 \
  read-flash 0 0x400000 fastled_full_4mb.bin
```

恢复会覆盖整片 Flash，仅在明确需要恢复演示环境时使用：

```bash
esptool --chip esp32s3 --port COMx --baud 460800 \
  write-flash 0 fastled_full_4mb.bin
```

截至 2026-10-29，dump 的大小和 SHA-256 已校验；自动迁移到 Navio、恢复写入及整片哈希
校验均已实测，恢复后 RGB 演示正常。此文件作为实机测试资产保存，不表示对其中第三方代码
附加新的分发许可。
