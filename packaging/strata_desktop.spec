# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — build the Strata Desktop single-file executable.

    pip install pyinstaller
    pyinstaller packaging/strata_desktop.spec        # -> dist/Strata(.exe)

One file, windowed (no console). The whole `strata` package is collected because the app
imports several submodules lazily at runtime. An optional platform icon is picked up if you
drop one next to this spec (strata.ico on Windows, strata.icns on macOS).
"""
import os

from PyInstaller.utils.hooks import collect_submodules

REPO = os.path.dirname(SPECPATH)                       # noqa: F821 (SPECPATH injected by PyInstaller)
hiddenimports = collect_submodules("strata")

# optional icon, only if present
_ico = os.path.join(SPECPATH, "strata.ico")           # noqa: F821
_icns = os.path.join(SPECPATH, "strata.icns")         # noqa: F821
icon = _ico if os.path.exists(_ico) else (_icns if os.path.exists(_icns) else None)

a = Analysis(
    [os.path.join(SPECPATH, "strata_desktop_launch.py")],   # noqa: F821
    pathex=[REPO],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["numpy", "pandas", "matplotlib", "scipy", "PIL"],  # pure-stdlib app; keep it lean
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="Strata",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    runtime_tmpdir=None,
    console=False,                 # windowed desktop app
    disable_windowed_traceback=False,
    icon=icon,
)
