"""
build.py — Voyager Build Pipeline
====================================
Usage:
    python build.py                   # patch bump (1.2.0 → 1.2.1)
    python build.py --minor           # minor bump (1.2.0 → 1.3.0)
    python build.py --major           # major bump (1.2.0 → 2.0.0)
    python build.py --no-upload       # build only, skip GitHub upload
    python build.py --version 1.5.0   # set explicit version

Steps performed:
    1. Bump version in version.json
    2. Embed app source + version into launcher.py via launcher_template.py
    3. Compile with PyInstaller  (→ dist/Voyager/)
    4. Package installer with Inno Setup  (→ installer_output/Voyager-Setup-X.Y.Z.exe)
    5. Upload release to GitHub + update version.json
"""

import argparse, ast, base64, io, json, os, re, shutil, subprocess, sys, zipfile
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────────
ROOT       = Path(__file__).parent
APP_DIR    = ROOT / "app"
TMPL       = ROOT / "launcher_template.py"
OUT_PY     = ROOT / "launcher.py"
VER_FILE   = ROOT / "version.json"
ASSETS     = ROOT / "assets"
ISS_FILE   = ROOT / "voyager.iss"
DIST_DIR   = ROOT / "dist" / "Voyager"
OUT_DIR    = ROOT / "installer_output"

# Your GitHub repo for releases — set these:
GITHUB_REPO       = "Swoodles/voyager-releases"          # e.g. "alice/voyager"
GITHUB_ASSET_NAME = "Voyager-Setup.exe"                       # fixed name in each release
# Raw URL of version.json in your repo (GitHub Pages or raw.githubusercontent):
VERSION_JSON_URL  = f"https://raw.githubusercontent.com/Swoodles/voyager-releases/master/version.json"

# ── Argument parsing ───────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Voyager build pipeline")
grp = parser.add_mutually_exclusive_group()
grp.add_argument("--major",   action="store_true", help="Major version bump")
grp.add_argument("--minor",   action="store_true", help="Minor version bump")
grp.add_argument("--version", metavar="X.Y.Z",     help="Set explicit version")
parser.add_argument("--no-upload", action="store_true", help="Skip GitHub upload step")
parser.add_argument("--dev", action="store_true", help="Dev build: inject debug console, skip version bump/upload")
args = parser.parse_args()


def step(n, msg):
    print(f"\n{'='*60}")
    print(f"  STEP {n}: {msg}")
    print(f"{'='*60}")


def run(cmd, **kw):
    """Run a shell command; exit on failure."""
    print(f"  $ {cmd if isinstance(cmd, str) else ' '.join(cmd)}")
    r = subprocess.run(cmd, shell=isinstance(cmd, str), **kw)
    if r.returncode != 0:
        print(f"\n  ERROR: command failed (exit {r.returncode})")
        sys.exit(r.returncode)
    return r


# ─────────────────────────────────────────────────────────────────
# STEP 1 — Version bump
# ─────────────────────────────────────────────────────────────────
step(1, "Version bump")

ver_data = json.loads(VER_FILE.read_text(encoding="utf-8")) if VER_FILE.exists() else {}
cur = ver_data.get("version", "1.0.0")
major, minor, patch = (int(x) for x in cur.split("."))

if args.version:
    new_ver = args.version
elif args.major:
    new_ver = f"{major+1}.0.0"
elif args.minor:
    new_ver = f"{major}.{minor+1}.0"
else:
    new_ver = f"{major}.{minor}.{patch+1}"

download_url = (
    f"https://github.com/{GITHUB_REPO}/releases/latest/download/{GITHUB_ASSET_NAME}"
)

ver_data.update({
    "version":       new_ver,
    "download_url":  download_url,
    "release_notes": ver_data.get("release_notes", "Improvements and bug fixes"),
})
if not args.dev:
    VER_FILE.write_text(json.dumps(ver_data, indent=2), encoding="utf-8")
print(f"  Version: {cur} → {new_ver}" + (" (DEV)" if args.dev else ""))


# ─────────────────────────────────────────────────────────────────
# STEP 2 — Embed source into launcher.py
# ─────────────────────────────────────────────────────────────────
step(2, "Embedding source into launcher.py")

required = [
    APP_DIR / "src"    / "index.html",
    APP_DIR / "assets" / "icon.ico",
    APP_DIR / "assets" / "icon.png",
    APP_DIR / "package.json",
    TMPL,
]
for p in required:
    if not p.exists():
        print(f"  ERROR: Missing required file: {p}")
        sys.exit(1)

buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
    for f in APP_DIR.rglob("*"):
        if f.is_file() and "node_modules" not in f.parts and "dist" not in f.parts:
            arc = "voyager-app/" + f.relative_to(APP_DIR).as_posix()
            zf.write(f, arc)
            print(f"  + {arc}  ({f.stat().st_size:,} bytes)")

zip_bytes = buf.getvalue()
src_b64   = base64.b64encode(zip_bytes).decode()
print(f"\n  Source zip: {len(zip_bytes):,} bytes")

def to_tuple(b64: str) -> str:
    chunks = [b64[i:i+80] for i in range(0, len(b64), 80)]
    return "(\n" + "\n".join(f"    {repr(c)}" for c in chunks) + "\n)"

tmpl = TMPL.read_text(encoding="utf-8")
tmpl = re.sub(r'_SRC\s*=\s*\(.*?\)', f"_SRC = {to_tuple(src_b64)}", tmpl, flags=re.DOTALL)
tmpl = tmpl.replace('"PLACEHOLDER_VERSION"',   repr(new_ver))
tmpl = tmpl.replace('"PLACEHOLDER_UPDATE_URL"', repr(VERSION_JSON_URL))
tmpl = tmpl.replace('"PLACEHOLDER_DEV_MODE"',   "True" if args.dev else "False")

try:
    ast.parse(tmpl)
except SyntaxError as e:
    print(f"  ERROR: Syntax error in generated launcher: {e}")
    sys.exit(1)

OUT_PY.write_text(tmpl, encoding="utf-8")
print(f"  Output: {OUT_PY}  ({len(tmpl):,} bytes)")


# ─────────────────────────────────────────────────────────────────
# STEP 3 — PyInstaller
# ─────────────────────────────────────────────────────────────────
step(3, "Compiling with PyInstaller")

# ── Patch pywebview winforms.py: fix AccessibilityObject recursion bug ─
print("  Patching pywebview winforms.py...")
import site as _site
_wf_patched = False
_search_paths = _site.getsitepackages() + [
    os.path.join(os.environ.get("LOCALAPPDATA",""), "Programs", "Python", "Python312", "Lib", "site-packages"),
    os.path.join(os.environ.get("APPDATA",""), "Python", "Python312", "site-packages"),
]
for _sp in _search_paths:
    _wf = os.path.join(_sp, "webview", "platforms", "winforms.py")
    if os.path.exists(_wf):
        _code = open(_wf, encoding="utf-8").read()
        if "CreateAccessibilityInstance" not in _code:
            # Insert fix into BrowserForm class right after class definition line
            _fix = (
                "    def CreateAccessibilityInstance(self):\n"
                "        # Fix: prevents infinite recursion in Windows accessibility\n"
                "        return WinForms.Control.ControlAccessibleObject(self)\n"
            )
            _code = _code.replace(
                "class BrowserForm(WinForms.Form):\n        def __init__",
                "class BrowserForm(WinForms.Form):\n" + _fix + "        def __init__"
            )
            open(_wf, "w", encoding="utf-8").write(_code)
            print(f"  ✓ Patched: {_wf}")
        else:
            print(f"  ✓ Already patched: {_wf}")
        _wf_patched = True
        break
if not _wf_patched:
    print("  WARNING: winforms.py not found — accessibility bug may persist")

# Clean old build artifacts
for d in [ROOT / "dist", ROOT / "build" / "Voyager"]:
    if d.exists():
        shutil.rmtree(d)
        print(f"  Cleaned: {d}")

run([
    sys.executable, "-m", "PyInstaller",
    "--onedir",
    "--noconsole",
    "--clean",
    "--noconfirm",
    f"--icon={ASSETS / 'icon.ico'}",
    "--name", "Voyager",
    "--hidden-import", "winreg",
    "--hidden-import", "webview",
    "--hidden-import", "webview.platforms.winforms",
    "--hidden-import", "webview.platforms.edgechromium",
    "--hidden-import", "clr",
    "--collect-all", "webview",
    "--collect-all", "clr_loader",
    "--collect-all", "pythonnet",
    # Embed version info
    "--add-data", f"{VER_FILE};.",
    str(OUT_PY),
    str(ROOT / "updater.py"),
])

print(f"\n  Build output: {DIST_DIR}")


# ─────────────────────────────────────────────────────────────────
# STEP 4 — Inno Setup
# ─────────────────────────────────────────────────────────────────
step(4, "Packaging installer with Inno Setup")

OUT_DIR.mkdir(exist_ok=True)

# Patch version into .iss file at build time
iss_text = ISS_FILE.read_text(encoding="utf-8")
iss_text = re.sub(r'AppVersion=.*', f"AppVersion={new_ver}", iss_text)
tmp_iss  = ROOT / "_build_voyager.iss"
tmp_iss.write_text(iss_text, encoding="utf-8")

# Try to find iscc
iscc_candidates = [
    "iscc",
    r"C:\Users\abc12\AppData\Local\Programs\Inno Setup 7\ISCC.exe",
    r"C:\Program Files (x86)\Inno Setup 6\iscc.exe",
    r"C:\Program Files (x86)\Inno Setup 7\ISCC.exe",
    r"C:\Program Files\Inno Setup 6\iscc.exe",
    r"C:\Program Files\Inno Setup 7\ISCC.exe",
]
iscc = None
for c in iscc_candidates:
    try:
        r = subprocess.run([c, "/?"], capture_output=True)
        # ISCC returns non-zero for /? but still works — check if it ran at all
        if r.returncode in (0, 1) or b"Inno Setup" in r.stdout:
            iscc = c
            break
    except FileNotFoundError:
        continue

if not iscc:
    print("  ERROR: Inno Setup (iscc) not found.")
    print("  Install from: https://jrsoftware.org/isdl.php")
    sys.exit(1)

run([iscc, str(tmp_iss)])
tmp_iss.unlink(missing_ok=True)

# Find the actual installer (Inno Setup uses AppVersion from .iss, find by glob)
candidates = list(OUT_DIR.glob("Voyager-Setup-*.exe"))
installer = max(candidates, key=lambda f: f.stat().st_mtime) if candidates else None
if not installer or not installer.exists():
    print("  ERROR: Installer not found in installer_output\\")
    sys.exit(1)
print(f"\n  Installer: {installer} ({installer.stat().st_size:,} bytes)")


# ─────────────────────────────────────────────────────────────────
# STEP 5 — GitHub Release upload
# ─────────────────────────────────────────────────────────────────
if args.no_upload or args.dev:
    reason = "--dev build" if args.dev else "--no-upload set"
    print(f"\n  {reason}, skipping GitHub release.")
else:
    step(5, f"Creating GitHub release v{new_ver}")
    notes = ver_data.get("release_notes", "Improvements and bug fixes")

    # Check gh CLI is available
    if shutil.which("gh") is None:
        print("  WARNING: GitHub CLI (gh) not found. Skipping upload.")
        print("  Install from: https://cli.github.com/")
    else:
        run([
            "gh", "release", "create", f"v{new_ver}",
            str(installer),
            "--repo",  GITHUB_REPO,
            "--title", f"Voyager v{new_ver}",
            "--notes", notes,
            "--latest",
        ])

        # Push updated version.json to repo so the URL points to new release
        # (assumes repo is cloned locally or version.json is in same git repo)
        try:
            subprocess.run(["git", "add", "version.json"], check=True, cwd=ROOT)
            subprocess.run(["git", "commit", "-m", f"chore: bump version to {new_ver}"], check=True, cwd=ROOT)
            subprocess.run(["git", "push", "origin", "master"], check=True, cwd=ROOT)
            print("  version.json pushed to remote.")
        except subprocess.CalledProcessError:
            print("  NOTE: Could not auto-push version.json.")
            print("  Manually commit and push version.json to your repo.")


# ─────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────
print(f"""
{'='*60}
  BUILD COMPLETE
{'='*60}
  Version  : {new_ver}
  Installer: {installer}
  Size     : {installer.stat().st_size / 1_048_576:.1f} MB

  Next time you want to ship an update:
    1. Edit  app\\src\\index.html
    2. Run   python build.py
    Done. Users get the update automatically on next launch.
{'='*60}
""")
