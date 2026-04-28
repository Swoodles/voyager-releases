'use strict';

const { app, BrowserWindow, Menu, shell, dialog, nativeTheme } = require('electron');
const path = require('path');

// ——— SUPPRESS ALL CONSOLE OUTPUT IN PRODUCTION ———
// Prevents any terminal window from flashing or staying open
if (app.isPackaged) {
  const devNull = process.platform === 'win32' ? 'nul' : '/dev/null';
  try {
    const fs = require('fs');
    const nullOut = fs.openSync(devNull, 'w');
    process.stdout.write = (data) => true;
    process.stderr.write = (data) => true;
  } catch(e) {}
}

// ——— SINGLE INSTANCE LOCK ———
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;

// ——— WINDOW CREATION ———
function createWindow() {
  // Force dark mode to match the app design
  nativeTheme.themeSource = 'dark';

  mainWindow = new BrowserWindow({
    width:     1280,
    height:    820,
    minWidth:  900,
    minHeight: 600,
    title:     'Voyager — Vacation Planner',
    // Use correct icon path for both dev and packaged builds
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icon.png')
      : path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0e1117',
    show: false,   // Hidden until fully loaded — prevents white flash
    frame: true,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      webSecurity:      false,  // Required for map tiles + local API calls
      devTools:         !app.isPackaged,
    },
  });

  // Load the app
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Show only when fully rendered — no flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Redirect all external link clicks to the OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Silence renderer errors in production
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    if (!app.isPackaged) console.error('Renderer crashed:', details);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ——— BRING TO FRONT IF SECOND INSTANCE LAUNCHED ———
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ——— APPLICATION MENU ———
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'quit' }
    ]}] : []),
    {
      label: 'Voyager',
      submenu: [
        {
          label: 'About Voyager',
          click: () => dialog.showMessageBox(mainWindow, {
            type:    'info',
            title:   'Voyager',
            icon:    path.join(__dirname, 'assets', 'icon.png'),
            message: 'Voyager — Vacation Planner',
            detail:  `Version ${app.getVersion()}\n\nYour all-in-one travel companion.\nPlan · Organize · Explore`,
            buttons: ['OK'],
          }),
        },
        { type: 'separator' },
        {
          label:       'Quit Voyager',
          accelerator: isMac ? 'Cmd+Q' : 'Ctrl+Q',
          click:       () => app.quit(),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label:       'Reload',
          accelerator: 'CmdOrCtrl+R',
          click:       () => mainWindow?.reload(),
        },
        { type: 'separator' },
        {
          label:       'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click:       () => {
            if (mainWindow) {
              const z = mainWindow.webContents.getZoomFactor();
              mainWindow.webContents.setZoomFactor(Math.min(z + 0.1, 3));
            }
          },
        },
        {
          label:       'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click:       () => {
            if (mainWindow) {
              const z = mainWindow.webContents.getZoomFactor();
              mainWindow.webContents.setZoomFactor(Math.max(z - 0.1, 0.5));
            }
          },
        },
        {
          label:       'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click:       () => mainWindow?.webContents.setZoomFactor(1),
        },
        { type: 'separator' },
        {
          label:       'Toggle Fullscreen',
          accelerator: 'F11',
          click:       () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()),
        },
        ...(!app.isPackaged ? [
          { type: 'separator' },
          { label: 'Developer Tools', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
        ] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Firecrawl (Research API)', click: () => shell.openExternal('https://firecrawl.dev') },
        { label: 'Anthropic (AI API)',        click: () => shell.openExternal('https://console.anthropic.com') },
        { label: 'Transitland (Transit API)', click: () => shell.openExternal('https://transit.land') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ——— APP LIFECYCLE ———
app.whenReady().then(() => {
  // Suppress Chromium's noisy GPU/network logs
  app.commandLine.appendSwitch('disable-logging');
  app.commandLine.appendSwitch('log-level', '3');
  app.commandLine.appendSwitch('silent');

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Catch unhandled errors silently in production
process.on('uncaughtException', (err) => {
  if (!app.isPackaged) console.error('Uncaught exception:', err);
});
