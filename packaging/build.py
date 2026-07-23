#!/usr/bin/env python3
"""Build the Strata Desktop executable for the current OS.

    python packaging/build.py

Installs PyInstaller if missing, runs the spec, and reports where the binary landed
(``dist/Strata`` or ``dist/Strata.exe``). Cross-OS binaries are produced by CI
(``.github/workflows/desktop.yml``) — PyInstaller builds for the OS it runs on, so the
Windows/macOS/Linux artifacts come from the matching CI runners, not from one machine.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SPEC = os.path.join(HERE, "strata_desktop.spec")


def _have_pyinstaller() -> bool:
    try:
        import PyInstaller  # noqa: F401
        return True
    except Exception:
        return False


def main() -> int:
    if not _have_pyinstaller():
        print("PyInstaller not found — installing it…")
        rc = subprocess.call([sys.executable, "-m", "pip", "install", "pyinstaller"])
        if rc != 0:
            print("Could not install PyInstaller. Install it and re-run:  pip install pyinstaller")
            return rc
    print(f"Building Strata Desktop for {sys.platform}…")
    rc = subprocess.call([sys.executable, "-m", "PyInstaller", "--noconfirm",
                          "--distpath", os.path.join(REPO, "dist"),
                          "--workpath", os.path.join(REPO, "build"), SPEC],
                         cwd=REPO)
    if rc != 0:
        return rc
    name = "Strata.exe" if os.name == "nt" else "Strata"
    out = os.path.join(REPO, "dist", name)
    print("\nBuilt:", out if os.path.exists(out) else "(check dist/)")
    print("Run it directly, or ship it — it is a self-contained desktop app.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
