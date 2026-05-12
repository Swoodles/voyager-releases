# launcher_patch.py
# ─────────────────────────────────────────────────────────────────────────────
# Add the following to your existing launcher.py.
# This snippet shows WHERE and WHAT to add — do not replace your launcher.py,
# just merge these additions into it.
# ─────────────────────────────────────────────────────────────────────────────

# ── 1. At the TOP of launcher.py, with your other imports ────────────────────
from ai_bridge import start_bridge, stop_bridge

# ── 2. In your startup block (after logging is configured, before UI loads) ──
# Replace your existing startup section with:

def on_startup():
    """Called once when the app is initialising."""

    # Start the AI backend — blocks until ready or timeout
    ai_ok = start_bridge()
    if not ai_ok:
        # Non-fatal: Voyager still works without AI features
        print("[launcher] WARNING: AI backend not available — AI features disabled")

    # ... rest of your existing startup code ...


# ── 3. In your shutdown / window-close handler ───────────────────────────────
def on_close():
    """Called when the main window is about to close."""
    stop_bridge()
    # ... rest of your existing shutdown code (sys.exit, etc.) ...


# ─────────────────────────────────────────────────────────────────────────────
# PyInstaller note:
# Make sure ai_bridge.py and the voyager-ai/ folder are included in your
# .spec file's datas list, e.g.:
#
#   datas=[
#       ('ai_bridge.py', '.'),
#       ('voyager-ai', 'voyager-ai'),
#   ]
#
# If bundling Node.js, also add:
#   datas=[('node_bundled/node.exe', 'voyager-ai')]   # Windows
#   datas=[('node_bundled/node',     'voyager-ai')]   # macOS/Linux
# ─────────────────────────────────────────────────────────────────────────────
