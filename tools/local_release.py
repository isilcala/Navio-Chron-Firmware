Import("env")

import os
import subprocess
import sys

if env["PIOENV"] == "navio_chron":
    def make_local_release(target, source, env):
        project_dir = env.subst("$PROJECT_DIR")
        subprocess.run(
            [sys.executable, os.path.join(project_dir, "tools", "make_release.py"), "navio_chron"],
            cwd=project_dir,
            check=True,
        )

    env.AddPostAction("$BUILD_DIR/firmware.bin", make_local_release)
