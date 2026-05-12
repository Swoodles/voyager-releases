# ai_bridge.py
# Manages the voyager-ai Node.js subprocess lifecycle.
# Place this file next to launcher.py.
#
# Usage in launcher.py:
#   from ai_bridge import AIBridge
#   bridge = AIBridge()
#   bridge.start()          # call on app startup
#   bridge.stop()           # call on app close

import os
import sys
import time
import shutil
import subprocess
import threading
import requests
import logging

logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────
AI_PORT        = int(os.environ.get("VOYAGER_AI_PORT", 3747))
AI_HEALTH_URL  = f"http://127.0.0.1:{AI_PORT}/health"
READY_MARKER   = "VOYAGER_AI_READY"          # stdout string server emits when ready
STARTUP_TIMEOUT = 30                          # seconds to wait for server to be ready
HEALTH_RETRIES  = 40
HEALTH_INTERVAL = 0.75                        # seconds between health-check retries


class AIBridge:
    """
    Starts voyager-ai/server.js as a hidden subprocess and provides
    health-checked startup + clean shutdown.
    """

    def __init__(self, app_dir: str = None):
        # Default: voyager-ai/ folder sits next to this file
        base = app_dir or os.path.dirname(os.path.abspath(__file__))
        self.server_dir  = os.path.join(base, "voyager-ai")
        self.server_js   = os.path.join(self.server_dir, "server.js")
        self.process: subprocess.Popen | None = None
        self._log_thread: threading.Thread | None = None
        self._ready      = False

    # ── Public API ─────────────────────────────────────────────────────────────

    def start(self) -> bool:
        """
        Start the Node.js server and block until it is ready to accept requests.
        Returns True on success, False on failure.
        """
        node = self._find_node()
        if not node:
            logger.error("[ai_bridge] Cannot find node executable — AI features disabled")
            return False

        if not os.path.exists(self.server_js):
            logger.error(f"[ai_bridge] server.js not found at {self.server_js}")
            return False

        env = {**os.environ, "VOYAGER_AI_PORT": str(AI_PORT)}

        logger.info(f"[ai_bridge] Starting voyager-ai on port {AI_PORT}...")
        self.process = subprocess.Popen(
            [node, "server.js"],
            cwd=self.server_dir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            # Hide console window on Windows
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )

        # Stream logs in background
        self._log_thread = threading.Thread(
            target=self._stream_logs, daemon=True
        )
        self._log_thread.start()

        # Wait for ready signal
        self._ready = self._wait_for_ready()
        if self._ready:
            logger.info("[ai_bridge] voyager-ai is ready ✓")
        else:
            logger.error("[ai_bridge] voyager-ai failed to start within timeout")
            self.stop()
        return self._ready

    def stop(self):
        """Gracefully terminate the Node.js process."""
        if self.process and self.process.poll() is None:
            logger.info("[ai_bridge] Stopping voyager-ai...")
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.process = None
        self._ready  = False

    @property
    def is_ready(self) -> bool:
        return self._ready and self.process is not None and self.process.poll() is None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{AI_PORT}"

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _wait_for_ready(self) -> bool:
        """Poll the health endpoint until the server responds or timeout."""
        deadline = time.time() + STARTUP_TIMEOUT
        for _ in range(HEALTH_RETRIES):
            if time.time() > deadline:
                break
            if self.process and self.process.poll() is not None:
                logger.error("[ai_bridge] Process exited prematurely")
                return False
            try:
                r = requests.get(AI_HEALTH_URL, timeout=2)
                if r.status_code == 200 and r.json().get("ok"):
                    return True
            except Exception:
                pass
            time.sleep(HEALTH_INTERVAL)
        return False

    def _stream_logs(self):
        """Forward Node.js stdout to Python logger."""
        if not self.process or not self.process.stdout:
            return
        for line in self.process.stdout:
            line = line.rstrip()
            if line:
                logger.debug(f"[voyager-ai] {line}")

    def _find_node(self) -> str | None:
        """
        Find the node executable.
        Search order:
          1. Bundled node next to server.js (for PyInstaller distribution)
          2. System PATH
        """
        bundled = os.path.join(
            self.server_dir,
            "node.exe" if sys.platform == "win32" else "node"
        )
        if os.path.isfile(bundled):
            return bundled
        return shutil.which("node")


# ── Singleton for use by launcher.py ─────────────────────────────────────────
_bridge: AIBridge | None = None


def get_bridge() -> AIBridge:
    global _bridge
    if _bridge is None:
        _bridge = AIBridge()
    return _bridge


def start_bridge() -> bool:
    return get_bridge().start()


def stop_bridge():
    get_bridge().stop()
