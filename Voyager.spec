# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all
import os

# ── Base path — change this if you move the project ──────────────────────────
BASE = 'C:\\Users\\abc12\\files'

datas = [
    # ── Existing ──────────────────────────────────────────────────────────────
    (os.path.join(BASE, 'version.json'),        '.'),
    (os.path.join(BASE, 'assets'),              'assets'),

    # ── AI Bridge (Python module imported by launcher.py) ─────────────────────
    # PyInstaller auto-discovers imported .py files, but listing it explicitly
    # guarantees it's included even if the import is conditional.
    (os.path.join(BASE, 'ai_bridge.py'),        '.'),
    (os.path.join(BASE, 'launcher_patch.py'),   '.'),

    # ── Voyager AI v2 backend (entire Node.js folder) ─────────────────────────
    # Bundled as a data folder so ai_bridge.py can locate and launch server.js.
    # node_modules must be present (run `npm ci --omit=dev` first).
    # The .env file is intentionally excluded here — users supply it separately.
    (os.path.join(BASE, 'voyager-ai', 'server.js'),              'voyager-ai'),
    (os.path.join(BASE, 'voyager-ai', 'package.json'),           'voyager-ai'),
    (os.path.join(BASE, 'voyager-ai', 'src'),                    'voyager-ai\\src'),
    (os.path.join(BASE, 'voyager-ai', 'node_modules'),           'voyager-ai\\node_modules'),

    # ── Frontend app ──────────────────────────────────────────────────────────
    (os.path.join(BASE, 'app'),                 'app'),
]

binaries = []

hiddenimports = [
    'winreg',
    'webview',
    'webview.platforms.winforms',
    'webview.platforms.edgechromium',
    'clr',
    # ai_bridge dependencies
    'requests',
    'subprocess',
    'threading',
    'shutil',
]

tmp_ret = collect_all('webview')
datas    += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('clr_loader')
datas    += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('pythonnet')
datas    += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

a = Analysis(
    [
        os.path.join(BASE, 'launcher.py'),
        os.path.join(BASE, 'updater.py'),
    ],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude heavy unused packages to keep build size down
        'matplotlib', 'numpy', 'pandas', 'scipy', 'PIL',
        'tkinter', 'unittest', 'pydoc', 'doctest',
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Voyager',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=[os.path.join(BASE, 'assets', 'icon.ico')],
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Voyager',
)
