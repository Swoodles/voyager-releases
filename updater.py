"""
updater.py — Voyager Auto-Updater
==================================
Handles silent background update checks, downloads, and installs.
Discord/Notion-style: download in background, prompt on completion.
"""

import os, sys, json, logging, threading, hashlib, subprocess, time
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

log = logging.getLogger("voyager.updater")

# ── Paths ──────────────────────────────────────────────────────────
_DATA    = Path(os.environ.get("LOCALAPPDATA", os.environ.get("TEMP", "."))) / "Voyager"
_UPD_DIR = _DATA / "updates"
_UPD_DIR.mkdir(parents=True, exist_ok=True)

# ── Constants ──────────────────────────────────────────────────────
_TIMEOUT     = 10   # seconds for network requests
_CHUNK       = 65536


def _ver_tuple(v: str):
    """'1.2.3' → (1, 2, 3)  — safe for comparison."""
    try:
        return tuple(int(x) for x in str(v).strip().split("."))
    except Exception:
        return (0, 0, 0)


class UpdateInfo:
    """Holds metadata about an available update."""
    def __init__(self, data: dict):
        self.version      = data.get("version", "0.0.0")
        self.download_url = data.get("download_url", "")
        self.release_notes = data.get("release_notes", "")
        self.installer_path: Path | None = None
        self.ready        = False   # True when download complete
        self.progress     = 0       # 0-100


class Updater:
    """
    Usage:
        u = Updater(current_version="1.2.0", update_url="https://...")
        u.check_async(on_update_ready=callback)
    """

    def __init__(self, current_version: str, update_url: str):
        self.current   = current_version
        self.url       = update_url
        self.info: UpdateInfo | None = None
        self._lock     = threading.Lock()
        self._thread: threading.Thread | None = None
        self._on_ready = None

    # ── Public API ─────────────────────────────────────────────────

    def check_async(self, on_update_ready=None):
        """
        Start background update check.
        on_update_ready(info: UpdateInfo) called when download completes.
        """
        self._on_ready = on_update_ready
        self._thread = threading.Thread(target=self._run, daemon=True, name="updater")
        self._thread.start()

    def install_and_restart(self):
        """
        Close the app and silently run the downloaded installer.
        Call this when the user accepts the update.
        """
        if not self.info or not self.info.ready or not self.info.installer_path:
            log.error("install_and_restart called but update not ready")
            return
        path = str(self.info.installer_path)
        log.info("Launching installer: %s", path)
        try:
            # /SILENT     — no wizard, just progress bar
            # /SUPPRESSMSGBOXES — no popups
            # /NORESTART  — don't reboot windows
            subprocess.Popen(
                [path, "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART"],
                creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
                close_fds=True,
            )
        except Exception as e:
            log.exception("Failed to launch installer: %s", e)
            return
        # Give installer a moment to start, then exit
        time.sleep(0.5)
        sys.exit(0)

    @property
    def is_ready(self):
        return self.info is not None and self.info.ready

    # ── Internal ───────────────────────────────────────────────────

    def _run(self):
        try:
            info = self._check()
            if info is None:
                log.info("No update available (current=%s)", self.current)
                return
            log.info("Update available: %s → %s", self.current, info.version)
            with self._lock:
                self.info = info
            self._download(info)
        except Exception:
            log.exception("Updater background thread error")

    def _check(self) -> "UpdateInfo | None":
        """Fetch version.json and return UpdateInfo if newer version found."""
        log.info("Checking for updates at %s", self.url)
        try:
            req = Request(self.url, headers={"User-Agent": "Voyager-Updater/1.0", "Cache-Control": "no-cache"})
            with urlopen(req, timeout=_TIMEOUT) as resp:
                data = json.loads(resp.read().decode())
        except (URLError, HTTPError, json.JSONDecodeError) as e:
            log.warning("Update check failed: %s", e)
            return None

        remote_ver = data.get("version", "0.0.0")
        if _ver_tuple(remote_ver) <= _ver_tuple(self.current):
            return None

        # Check if we already downloaded this version
        info = UpdateInfo(data)
        candidate = _UPD_DIR / f"Voyager-Setup-{info.version}.exe"
        if candidate.exists() and candidate.stat().st_size > 1_000_000:
            log.info("Update %s already downloaded at %s", info.version, candidate)
            info.installer_path = candidate
            info.ready = True
            info.progress = 100
            if self._on_ready:
                self._on_ready(info)
            return info

        return info

    def _download(self, info: UpdateInfo):
        """Stream download with progress tracking."""
        url  = info.download_url
        dest = _UPD_DIR / f"Voyager-Setup-{info.version}.exe"
        tmp  = dest.with_suffix(".tmp")

        log.info("Downloading update %s from %s", info.version, url)
        try:
            req = Request(url, headers={"User-Agent": "Voyager-Updater/1.0"})
            with urlopen(req, timeout=60) as resp:
                total = int(resp.headers.get("Content-Length", 0))
                downloaded = 0
                with open(tmp, "wb") as f:
                    while True:
                        chunk = resp.read(_CHUNK)
                        if not chunk:
                            break
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total > 0:
                            info.progress = int(downloaded / total * 100)

        except Exception as e:
            log.exception("Download failed: %s", e)
            try:
                tmp.unlink(missing_ok=True)
            except Exception:
                pass
            return

        # Rename tmp → final
        try:
            if dest.exists():
                dest.unlink()
            tmp.rename(dest)
        except Exception as e:
            log.exception("Failed to finalize download: %s", e)
            return

        log.info("Download complete: %s (%d bytes)", dest, dest.stat().st_size)
        info.installer_path = dest
        info.ready = True
        info.progress = 100

        # Clean up old update files
        self._cleanup_old(keep=dest)

        if self._on_ready:
            try:
                self._on_ready(info)
            except Exception:
                log.exception("on_update_ready callback error")

    def _cleanup_old(self, keep: Path):
        """Remove old downloaded installers to save disk space."""
        try:
            for f in _UPD_DIR.glob("Voyager-Setup-*.exe"):
                if f != keep:
                    f.unlink(missing_ok=True)
                    log.info("Removed old update: %s", f.name)
        except Exception:
            pass
