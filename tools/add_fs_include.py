# core 3.x USB 库（框架内置）编译 MSC 子模块需要 FS.h，但 PIO 不会把
# libraries/FS/src 加进该库的包含路径（depends=FS 声明未被链式处理）。
# 注入 SCons 默认环境以覆盖所有派生构建环境（含库环境）。
Import("env")
from SCons.Script import DefaultEnvironment

DefaultEnvironment().Append(CPPPATH=[
    env.subst("$PROJECT_INCLUDE_DIR"),
    env.subst("$PROJECT_LIBDEPS_DIR/$PIOENV/Adafruit TinyUSB Library/src"),
])

fw = env.PioPlatform().get_package_dir("framework-arduinoespressif32")
if fw:
    fs_include = (fw + "/libraries/FS/src").replace("\\", "/")
    # FS.h 可用时 SdFat 有意不定义 File；确认接受该共存规则，关闭其提示。
    DefaultEnvironment().Append(
        CCFLAGS=["-I" + fs_include],
        CPPDEFINES=["DISABLE_FS_H_WARNING"],
    )
