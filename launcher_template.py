"""
launcher.py — Voyager Main Entry Point
DO NOT run directly. Run build.py first.
"""
import sys, os, base64, zipfile, io, shutil, logging, threading, time, winreg
import subprocess, traceback, socket
from pathlib import Path

_DATA      = Path(os.environ.get("LOCALAPPDATA", os.environ.get("TEMP", "."))) / "Voyager"
_APP       = _DATA / "app"
_WEBVIEW2  = _DATA / "webview2"

for d in (_DATA, _APP, _WEBVIEW2):
    d.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    filename=str(_DATA / "voyager.log"),
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
log = logging.getLogger("voyager")

_VER        = "PLACEHOLDER_VERSION"
_UPDATE_URL = "PLACEHOLDER_UPDATE_URL"
_DEV_MODE   = "PLACEHOLDER_DEV_MODE"   # True in dev builds, False in release
_SRC = (
    "PLACEHOLDER_RUN_BUILD_PY"
)

_UPDATE_BAR_JS = """
(function() {{
  if (document.getElementById('_voy_upd')) return;
  var s = document.createElement('style');
  s.textContent = '@keyframes _vslide{{from{{transform:translateY(-100%)}}to{{transform:translateY(0)}}}}';
  document.head.appendChild(s);
  var b = document.createElement('div');
  b.id = '_voy_upd';
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:linear-gradient(90deg,#1a3a52,#1e4d70);color:#e8f4fd;padding:9px 16px;display:flex;align-items:center;justify-content:space-between;font:13px/1 Segoe UI,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4);animation:_vslide .3s ease';
  b.innerHTML = '<span>&#10022;&nbsp;<b>Voyager {ver}</b> is ready - {notes}</span><div style="display:flex;gap:8px"><button onclick="this.closest(\\'#_voy_upd\\').remove()" style="background:transparent;border:1px solid #4bb8e8;color:#4bb8e8;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px">Later</button><button onclick="window.pywebview.api.install_update()" style="background:#4bb8e8;border:none;color:#0e1117;padding:4px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600">Restart &amp; Update</button></div>';
  document.body.prepend(b);
}})();
"""

# ── Dev-only debug overlay — injected only when _DEV_MODE = True ───
_DEBUG_BRIDGE_JS = r"""
(function() {
  const PORT = 9999;
  const _post = (lvl, msg) => fetch('http://127.0.0.1:' + PORT + '/', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({lvl, msg: String(msg).slice(0, 500)})
  }).catch(()=>{});

  // Intercept console
  ['log','info','warn','error'].forEach(lvl => {
    const orig = console[lvl];
    console[lvl] = function() {
      orig.apply(console, arguments);
      _post(lvl, Array.from(arguments).map(a => {
        try { return typeof a==='object' ? JSON.stringify(a) : String(a); } catch(e) { return String(a); }
      }).join(' '));
    };
  });

  // Intercept errors
  window.addEventListener('error', e => _post('error', e.message + ' @ ' + (e.filename||'').split('/').pop() + ':' + e.lineno));
  window.addEventListener('unhandledrejection', e => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
    _post('error', 'UNHANDLED REJECTION: ' + msg);
  });

  // Intercept fetch
  const _orig = window.fetch;
  window.fetch = function(input, init) {
    const url = typeof input==='string' ? input : (input.url||String(input));
    const method = (init&&init.method)||'GET';
    const t0 = Date.now();
    return _orig.apply(this, arguments).then(r => {
      _post('net', method + ' ' + r.status + ' ' + url.replace(/^https?:\/\//,'').slice(0,80) + ' (' + (Date.now()-t0) + 'ms)');
      return r;
    }).catch(err => {
      _post('error', 'FETCH FAIL: ' + url.slice(0,80) + ' — ' + err.message);
      throw err;
    });
  };

  _post('info', 'Voyager debug bridge connected — version: ' + (window.__voyager_version||'unknown'));
  console.log('[DBG] Debug bridge active on port ' + PORT);
})();
"""

_DEBUG_PANEL_JS = r"""
(function() {
  if (document.getElementById('_voy_dbg')) return;

  // ── Panel HTML ────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.id = '_voy_dbg';
  panel.style.cssText = [
    'position:fixed','bottom:0','right:0','width:420px','max-height:45vh',
    'background:#0a0f1a','border:1px solid #1e3a5a','border-radius:8px 0 0 0',
    'z-index:2147483646','font:11px/1.4 monospace','display:flex',
    'flex-direction:column','box-shadow:-2px -2px 20px rgba(0,0,0,.6)',
    'transition:max-height .2s'
  ].join(';');

  var header = '<div style="display:flex;align-items:center;justify-content:space-between;'
    + 'padding:6px 10px;background:#0e1a2e;border-bottom:1px solid #1e3a5a;cursor:pointer;'
    + 'border-radius:8px 0 0 0" id="_voy_dbg_hdr">'
    + '<span style="color:#4bb8e8;font-weight:700;font-size:11px">&#128030; DEV CONSOLE</span>'
    + '<div style="display:flex;gap:6px">'
    + '<button id="_voy_dbg_clr" style="background:#1e3a5a;border:none;color:#aaa;padding:2px 7px;'
    +   'border-radius:3px;cursor:pointer;font-size:10px">Clear</button>'
    + '<button id="_voy_dbg_min" style="background:#1e3a5a;border:none;color:#aaa;padding:2px 7px;'
    +   'border-radius:3px;cursor:pointer;font-size:10px">&#8595;</button>'
    + '</div></div>';

  var log_area = '<div id="_voy_dbg_log" style="overflow-y:auto;flex:1;padding:6px 8px;'
    + 'color:#c8d8e8;font-size:10.5px;line-height:1.5"></div>';

  var net_area = '<div id="_voy_dbg_net" style="display:none;overflow-y:auto;flex:1;'
    + 'padding:6px 8px;color:#c8d8e8;font-size:10.5px;line-height:1.5"></div>';

  var tabs = '<div style="display:flex;border-top:1px solid #1e3a5a">'
    + '<div class="_voy_tab active" data-tab="log" style="flex:1;text-align:center;padding:4px;'
    +   'cursor:pointer;color:#4bb8e8;font-size:10px;background:#0e1a2e">Console</div>'
    + '<div class="_voy_tab" data-tab="net" style="flex:1;text-align:center;padding:4px;'
    +   'cursor:pointer;color:#556;font-size:10px">Network</div>'
    + '</div>';

  panel.innerHTML = header + log_area + net_area + tabs;
  document.body.appendChild(panel);

  // ── Tab switching ──────────────────────────────────────────────
  var tabStyle = {active:'color:#4bb8e8;background:#0e1a2e', inactive:'color:#556'};
  document.querySelectorAll('._voy_tab').forEach(function(t) {
    t.addEventListener('click', function() {
      var name = t.dataset.tab;
      document.querySelectorAll('._voy_tab').forEach(function(x) {
        x.style.cssText = 'flex:1;text-align:center;padding:4px;cursor:pointer;font-size:10px;'
          + (x.dataset.tab === name ? tabStyle.active : tabStyle.inactive);
      });
      document.getElementById('_voy_dbg_log').style.display = name==='log' ? 'block' : 'none';
      document.getElementById('_voy_dbg_net').style.display = name==='net' ? 'block' : 'none';
    });
  });

  // ── Minimize/restore ──────────────────────────────────────────
  var minimized = false;
  document.getElementById('_voy_dbg_hdr').addEventListener('click', function(e) {
    if (e.target.tagName === 'BUTTON') return;
    minimized = !minimized;
    panel.style.maxHeight = minimized ? '32px' : '45vh';
    document.getElementById('_voy_dbg_min').textContent = minimized ? '↑' : '↓';
  });

  // ── Clear ──────────────────────────────────────────────────────
  document.getElementById('_voy_dbg_clr').addEventListener('click', function(e) {
    e.stopPropagation();
    document.getElementById('_voy_dbg_log').innerHTML = '';
    document.getElementById('_voy_dbg_net').innerHTML = '';
    netEntries = [];
  });

  // ── Logger ────────────────────────────────────────────────────
  var logEl = document.getElementById('_voy_dbg_log');
  var netEl = document.getElementById('_voy_dbg_net');
  var netEntries = [];
  var _maxLines  = 200;

  function appendLog(msg, color) {
    var d = document.createElement('div');
    d.style.cssText = 'color:' + (color||'#c8d8e8') + ';border-bottom:1px solid #0e1a2e;padding:1px 0;word-break:break-all';
    d.textContent = msg;
    logEl.appendChild(d);
    if (logEl.children.length > _maxLines) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function appendNet(method, url, status, ms) {
    var color = status >= 400 ? '#ff6b6b' : status >= 300 ? '#e8b84b' : '#5fba7d';
    var short = url.replace(/^https?:\/\//, '').slice(0, 55) + (url.length > 55 ? '...' : '');
    var d = document.createElement('div');
    d.style.cssText = 'border-bottom:1px solid #0e1a2e;padding:2px 0;display:flex;gap:6px;align-items:center';
    d.innerHTML = '<span style="color:#556;min-width:28px;font-size:9px">' + method + '</span>'
      + '<span style="color:' + color + ';min-width:30px;font-size:9px">' + status + '</span>'
      + '<span style="flex:1;color:#aaa;font-size:10px;word-break:break-all" title="' + url + '">' + short + '</span>'
      + '<span style="color:#556;font-size:9px;min-width:36px;text-align:right">' + ms + 'ms</span>';
    netEl.appendChild(d);
    if (netEl.children.length > _maxLines) netEl.removeChild(netEl.firstChild);
    netEl.scrollTop = netEl.scrollHeight;
  }

  // ── Intercept console ─────────────────────────────────────────
  var _con = {log:console.log, warn:console.warn, error:console.error, info:console.info};
  ['log','info','warn','error'].forEach(function(level) {
    console[level] = function() {
      _con[level].apply(console, arguments);
      var colors = {log:'#c8d8e8', info:'#4bb8e8', warn:'#e8b84b', error:'#ff6b6b'};
      var prefix = {log:'LOG', info:'INF', warn:'WRN', error:'ERR'};
      var msg = Array.from(arguments).map(function(a) {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
        catch(e) { return String(a); }
      }).join(' ');
      appendLog('[' + prefix[level] + '] ' + msg, colors[level]);
    };
  });

  // ── Intercept unhandled errors ────────────────────────────────
  window.addEventListener('error', function(e) {
    appendLog('[UNC] ' + e.message + ' @ ' + (e.filename||'?').split('/').pop() + ':' + e.lineno, '#ff6b6b');
  });
  window.addEventListener('unhandledrejection', function(e) {
    var msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
    appendLog('[REJ] ' + msg, '#ff6b6b');
  });

  // ── Intercept fetch ──────────────────────────────────────────
  var _origFetch = window.fetch;
  window.fetch = function(input, init) {
    var url   = typeof input === 'string' ? input : (input.url || String(input));
    var method = (init && init.method) || 'GET';
    var t0    = Date.now();
    return _origFetch.apply(this, arguments).then(function(resp) {
      appendNet(method, url, resp.status, Date.now()-t0);
      return resp;
    }).catch(function(err) {
      appendNet(method, url, 'ERR', Date.now()-t0);
      appendLog('[NET] FAIL: ' + url.slice(0,80) + ' — ' + err.message, '#ff6b6b');
      throw err;
    });
  };

  // ── Intercept XMLHttpRequest ──────────────────────────────────
  var _XHR = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var t0 = Date.now();
    this.addEventListener('loadend', function() {
      appendNet(method, url, this.status || 'ERR', Date.now()-t0);
    });
    return _XHR.apply(this, arguments);
  };

  appendLog('[DBG] Voyager dev console ready — watching errors, fetch & XHR', '#5fba7d');
  appendLog('[DBG] Version: ' + (window.__voyager_version || 'unknown'), '#4bb8e8');
})();
"""

def _has_webview2():
    keys = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
        (winreg.HKEY_CURRENT_USER,  r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
    ]
    for hive, path in keys:
        try:
            winreg.OpenKey(hive, path)
            return True
        except OSError:
            pass
    return False

def _prompt_webview2():
    import ctypes
    url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
    msg = "Voyager requires the Microsoft Edge WebView2 Runtime.\n\nClick OK to open the download page, then re-launch Voyager."
    if ctypes.windll.user32.MessageBoxW(0, msg, "Voyager - Missing Component", 0x41) == 1:
        subprocess.Popen(["rundll32", "url.dll,FileProtocolHandler", url])
    sys.exit(1)

def _free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

def _extract():
    ver_file = _APP / ".version"
    try:
        if _APP.exists() and ver_file.exists() and ver_file.read_text().strip() == _VER:
            log.info("App v%s already extracted.", _VER)
            return
    except Exception:
        pass
    log.info("Extracting app v%s ...", _VER)
    if _APP.exists():
        shutil.rmtree(str(_APP), ignore_errors=True)
    _APP.mkdir(parents=True, exist_ok=True)
    raw = base64.b64decode("".join(_SRC))
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for name in z.namelist():
            parts = name.split("/", 1)
            rel = parts[1] if len(parts) > 1 else ""
            if not rel:
                continue
            dst = _APP / rel
            if name.endswith("/"):
                dst.mkdir(parents=True, exist_ok=True)
            else:
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(z.read(name))
    ver_file.write_text(_VER)
    log.info("Extraction complete.")

class _Api:
    def __init__(self):
        self._updater = None
        self.window   = None

    def install_update(self):
        threading.Thread(target=self._do_install, daemon=True).start()

    def _do_install(self):
        log.info("User accepted update.")
        if self._updater and self._updater.is_ready:
            self._updater.install_and_restart()

    def get_version(self):
        return _VER

def _update_check(api):
    try:
        if not _UPDATE_URL or "PLACEHOLDER" in _UPDATE_URL:
            return
        from updater import Updater
        updater = Updater(current_version=_VER, update_url=_UPDATE_URL)
        api._updater = updater
        def on_ready(info):
            log.info("Update ready: v%s", info.version)
            notes = (info.release_notes[:60] + "...") if len(info.release_notes) > 60 else info.release_notes
            notes = notes or "improvements & bug fixes"
            js = _UPDATE_BAR_JS.format(ver=info.version, notes=notes)
            for _ in range(8):
                try:
                    if api._window:
                        api._window.evaluate_js(js)
                    return
                except Exception:
                    time.sleep(1)
        updater.check_async(on_update_ready=on_ready)
    except Exception:
        log.warning("Update check error:\n%s", traceback.format_exc())

def main():
    log.info("=" * 60)
    log.info("Voyager v%s starting (Python %s) dev=%s", _VER, sys.version.split()[0], _DEV_MODE)

    try:
        if not _has_webview2():
            _prompt_webview2()

        _extract()

        html = _APP / "src" / "index.html"
        if not html.exists():
            raise FileNotFoundError(f"index.html not found: {html}")

        port = _free_port()
        log.info("HTTP port: %d", port)

        import webview

        api    = _Api()
        window = webview.create_window(
            title            = "Voyager - Vacation Planner" + (" [DEV]" if _DEV_MODE else ""),
            url              = str(html),
            width            = 1280,
            height           = 820,
            min_size         = (900, 600),
            background_color = "#0e1117",
            js_api           = api,
        )
        api._window = window

        def on_loaded():
            log.info("Page loaded.")
            if _DEV_MODE:
                try:
                    window.evaluate_js(_DEBUG_BRIDGE_JS)
                    log.info("Debug bridge injected (posting to debug_viewer on port 9999).")
                except Exception as e:
                    log.warning("Debug bridge inject failed: %s", e)

        def on_started():
            log.info("Window ready.")
            threading.Thread(target=_update_check, args=(api,), daemon=True).start()

        window.events.loaded += on_loaded

        log.info("Starting webview (http_server=True, port=%d)...", port)
        webview.start(
            func         = on_started,
            storage_path = str(_WEBVIEW2),
            private_mode = False,
            http_server  = True,
            http_port    = port,
            debug        = False,
        )
        log.info("App exited cleanly.")

    except Exception:
        err = traceback.format_exc()
        log.error("Fatal:\n%s", err)
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                0,
                f"Voyager failed to start.\n\nLog: {_DATA}\\voyager.log\n\n{err[-400:]}",
                "Voyager Error", 0x10
            )
        except Exception:
            pass
        sys.exit(1)

if __name__ == "__main__":
    main()
