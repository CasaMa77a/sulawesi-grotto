const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const SPLASH_MS = 1800; // minimum splash display time
let splash = null;
let main = null;

function crashLog(text) {
  try {
    const f = path.join(app.getPath('userData'), 'crashlog.txt');
    fs.appendFileSync(f, `\n=== ${new Date().toISOString()} ===\n${text}\n`);
    return f;
  } catch { return null; }
}

function createSplash() {
  splash = new BrowserWindow({
    width: 460, height: 560,
    frame: false, resizable: false, center: true,
    alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#0a0a0a', show: false,
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', () => splash.show());
}

function createWindow() {
  main = new BrowserWindow({
    width: 1480, height: 920,
    minWidth: 900, minHeight: 600,
    backgroundColor: '#141414',
    title: "Sulawesi's Grotto",
    icon: path.join(__dirname, '..', 'public', 'logosulaw.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  main.webContents.on('render-process-gone', (_e, d) => {
    const f = crashLog(`render-process-gone: ${d.reason} (exit ${d.exitCode})`);
    dialog.showErrorBox(
      "Sulawesi's Grotto — render crash",
      `The renderer crashed (${d.reason}).\n\nReport saved to:\n${f || 'n/a'}\n\nSend it to the dev.`
    );
  });

  const dist = path.join(__dirname, '..', 'dist', 'index.html');
  if (process.env.GROTTO_DEV === '1' || !fs.existsSync(dist)) {
    main.loadURL('http://localhost:5173');
  } else {
    main.loadFile(dist);
  }

  const t0 = Date.now();
  main.once('ready-to-show', () => {
    const wait = Math.max(0, SPLASH_MS - (Date.now() - t0));
    setTimeout(() => {
      main.show();
      if (splash) { splash.close(); splash = null; }
    }, wait);
  });
}

process.on('uncaughtException', (err) => {
  const f = crashLog(String(err.stack || err));
  dialog.showErrorBox("Sulawesi's Grotto — crash",
    `${err.message || err}\n\nReport saved to:\n${f || 'n/a'}`);
});

app.whenReady().then(() => {
  createSplash();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
