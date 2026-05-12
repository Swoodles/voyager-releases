# updater.py
# Auto-update Voyager from GitHub Releases.
# Replaces the existing updater.py.
#
# Flow:
#   1. Read current version from version.json
#   2. Call GitHub Releases API to find latest release
#   3. If newer → download zip → extract (skipping .env / node_modules / cache)
#   4. Restart app
#
# Set GITHUB_REPO below to your actual "owner/repo" string.

import os
import sys
import json
import shutil
import zipfile
import logging
import tempfile
import threading
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Configuration — CHANGE THIS ───────────────────────────────────────────────
GITHUB_REPO     = "YOUR_USERNAME/voyager"          # e.g. "jsmith/voyager"
VERSION_FILE    = os.path.join(os.path.dirname(os.path.abspath(__file__)), "version.json")
RELEASES_API    = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
REQUEST_TIMEOUT = 15   # seconds

# Files / dirs to NEVER overwrite during an update
SKIP_PATHS = {
    ".env",
    "node_modules",
    "__pycache__",
    "version.json",   # updated separately after extraction
    ".git",
}


# ── Version helpers ───────────────────────────────────────────────────────────

def read_local_version() -> tuple[int, int, int]:
    """Return (major, minor, patch) from version.json, defaulting to (0,0,0)."""
    try:
        with open(VERSION_FILE) as f:
            data = json.load(f)
        v = data.get("version", "0.0.0")
        return tuple(int(x) for x in v.split(".")[:3])
    except Exception:
        return (0, 0, 0)


def parse_version(tag: str) -> tuple[int, int, int]:
    """Parse a GitHub tag like 'v1.2.3' or '1.2.3' into (1, 2, 3)."""
    clean = tag.lstrip("v")
    parts = clean.split(".")
    try:
        return tuple(int(x) for x in parts[:3])
    except ValueError:
        return (0, 0, 0)


# ── GitHub API ────────────────────────────────────────────────────────────────

def fetch_latest_release() -> dict | None:
    """Return the latest GitHub release dict or None on failure."""
    req = urllib.request.Request(
        RELEASES_API,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "VoyagerUpdater/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            return json.loads(resp.read())
    except Exception as e:
        logger.warning(f"[updater] Could not fetch release info: {e}")
        return None


def find_zip_asset(release: dict) -> str | None:
    """Return the download URL for the first .zip asset in the release."""
    for asset in release.get("assets", []):
        if asset["name"].endswith(".zip"):
            return asset["browser_download_url"]
    return None


# ── Download & Extract ────────────────────────────────────────────────────────

def download_file(url: str, dest: str):
    """Download url to dest with a simple progress log."""
    logger.info(f"[updater] Downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "VoyagerUpdater/1.0"})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        with open(dest, "wb") as f:
            while chunk := resp.read(65536):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded * 100 // total
                    if pct % 20 == 0:
                        logger.info(f"[updater] {pct}% downloaded")


def should_skip(path: str) -> bool:
    parts = Path(path).parts
    return any(p in SKIP_PATHS for p in parts)


def extract_update(zip_path: str, target_dir: str):
    """
    Extract zip into target_dir, skipping protected paths.
    The zip is expected to have a single top-level folder (GitHub default).
    """
    with zipfile.ZipFile(zip_path) as zf:
        members = zf.namelist()
        # Strip the top-level directory prefix that GitHub adds
        prefix = members[0].split("/")[0] + "/" if "/" in members[0] else ""

        for member in members:
            rel = member[len(prefix):]           # strip GitHub's "repo-tag/" prefix
            if not rel or should_skip(rel):
                continue

            dest = os.path.join(target_dir, rel)

            if member.endswith("/"):             # directory
                os.makedirs(dest, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with zf.open(member) as src, open(dest, "wb") as out:
                    shutil.copyfileobj(src, out)

    logger.info("[updater] Extraction complete")


def write_version(version_str: str):
    with open(VERSION_FILE, "w") as f:
        json.dump({"version": version_str}, f, indent=2)


# ── Restart ───────────────────────────────────────────────────────────────────

def restart_app():
    """Re-launch this process and exit the current one."""
    logger.info("[updater] Restarting app...")
    args = [sys.executable] + sys.argv
    if sys.platform == "win32":
        subprocess.Popen(args, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    else:
        os.execv(sys.executable, args)
    sys.exit(0)


# ── Main public API ───────────────────────────────────────────────────────────

def check_and_update(auto_restart: bool = True, on_progress=None) -> bool:
    """
    Check for an update and apply it if one is available.

    :param auto_restart:  Restart the app automatically after updating.
    :param on_progress:   Optional callable(str) for UI status messages.
    :returns: True if an update was applied.
    """
    def _notify(msg):
        logger.info(msg)
        if on_progress:
            on_progress(msg)

    local_version = read_local_version()
    _notify(f"[updater] Current version: {'.'.join(map(str, local_version))}")

    release = fetch_latest_release()
    if not release:
        _notify("[updater] Could not reach GitHub — skipping update check")
        return False

    tag            = release.get("tag_name", "")
    latest_version = parse_version(tag)

    if latest_version <= local_version:
        _notify(f"[updater] Already up to date ({tag})")
        return False

    _notify(f"[updater] New version available: {tag} — updating...")

    zip_url = find_zip_asset(release)
    if not zip_url:
        _notify("[updater] No zip asset found in release — skipping")
        return False

    app_dir = os.path.dirname(os.path.abspath(__file__))

    with tempfile.TemporaryDirectory() as tmp:
        zip_path = os.path.join(tmp, "update.zip")
        try:
            download_file(zip_url, zip_path)
        except Exception as e:
            _notify(f"[updater] Download failed: {e}")
            return False

        try:
            extract_update(zip_path, app_dir)
        except Exception as e:
            _notify(f"[updater] Extraction failed: {e}")
            return False

    # Write the new version AFTER successful extraction
    write_version(tag.lstrip("v"))
    _notify(f"[updater] Updated to {tag} ✓")

    if auto_restart:
        restart_app()

    return True


def check_and_update_async(on_progress=None, on_complete=None):
    """
    Run the update check in a background thread so the UI stays responsive.
    on_complete(updated: bool) is called when done.
    """
    def _run():
        result = check_and_update(auto_restart=True, on_progress=on_progress)
        if on_complete:
            on_complete(result)

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return t


# ── CLI usage ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    check_and_update(auto_restart="--no-restart" not in sys.argv)
