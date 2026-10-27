# 生成可直接用乐鑫官方 Flash Download Tool 刷写的固件发布包。
# 用法：python tools/make_release.py [env_name=navio_chron]
# 输出：release/<env>_<version>/ 四件套 + FLASH_LAYOUT.txt（地址/工具参数说明）
import os
import re
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = sys.argv[1] if len(sys.argv) > 1 else "navio_chron"
BUILD = os.path.join(ROOT, ".pio", "build", ENV)
OUT = os.path.join(ROOT, "release")

def main():
    ini = open(os.path.join(ROOT, "platformio.ini"), encoding="utf-8").read()
    m = re.search(r"NAVIO_CHRON_FW_VERSION=\\\"([^\\]+)\\\"", ini)
    version = m.group(1) if m else "unknown"
    outdir = os.path.join(OUT, f"{ENV}_{version}")
    if os.path.exists(outdir):
        shutil.rmtree(outdir)
    os.makedirs(outdir)

    # 三件来自构建目录；boot_app0 来自 Arduino 框架包（OTA 引导占位，0xE000）
    fw_pkg = os.path.join(os.path.expanduser("~"), ".platformio", "packages",
                          "framework-arduinoespressif32")
    boot_app0 = os.path.join(fw_pkg, "tools", "partitions", "boot_app0.bin")
    for src, name in [
        (os.path.join(BUILD, "bootloader.bin"), "bootloader.bin"),
        (os.path.join(BUILD, "partitions.bin"), "partitions.bin"),
        (boot_app0, "boot_app0.bin"),
        (os.path.join(BUILD, "firmware.bin"), "firmware.bin"),
    ]:
        if not os.path.exists(src):
            sys.exit(f"missing: {src}（先 pio run -e {ENV}）")
        shutil.copy2(src, os.path.join(outdir, name))

    layout = f"""Navio Chron 固件包 {version}（环境 {ENV}）
====================

方式一：乐鑫官方 Flash Download Tool（图形界面，推荐新手）
  1. 下载 Flash Download Tool（搜索 Espressif Flash Download Tool）并运行
  2. ChipType=ESP32-S3，WorkMode=Develop，LoadMode=UART
  3. 按下表添加 4 个文件与地址（勾选）：
       SPI FLASH: bootloader.bin  @ 0x0
       SPI FLASH: partitions.bin  @ 0x8000
       SPI FLASH: boot_app0.bin   @ 0xE000
       SPI FLASH: firmware.bin    @ 0x10000
  4. SPI FlashSize = 4MB（32Mbit）；SPI Speed = 40MHz；SPI Mode = DIO
  5. 接线/插 USB → START；需要时按住 BOOT 键再上电进入下载模式
  6. 烧完后断电重插即可

方式二：esptool 命令行（有 Python 环境者）
  pip install esptool
  esptool.py --chip esp32s3 --baud 921600 write_flash \\
    0x0 bootloader.bin 0x8000 partitions.bin 0xE000 boot_app0.bin 0x10000 firmware.bin

烧录后：LED0 显示当前预设色；单击侧键=切换预设，长按 5 秒=蓝牙配对，
长按 10 秒=进入下载模式（可直接上传新固件）。
"""
    open(os.path.join(outdir, "FLASH_LAYOUT.txt"), "w", encoding="utf-8").write(layout)

    zpath = os.path.join(OUT, f"{ENV}_{version}.zip")
    if os.path.exists(zpath):
        os.remove(zpath)
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for name in os.listdir(outdir):
            z.write(os.path.join(outdir, name), name)

    print("release 包已生成:")
    print(" ", outdir)
    print(" ", zpath)

if __name__ == "__main__":
    main()
