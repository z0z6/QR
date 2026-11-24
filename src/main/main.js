'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, clipboard, nativeImage, desktopCapturer, screen, session, powerSaveBlocker, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('QR');
app.commandLine.appendSwitch('lang', 'pl');
if (process.platform === 'win32') app.setAppUserModelId('pl.projektnumer4.qr');

// Wersja portable (Windows): ustawienia obok pliku .exe, żeby całość dało się nosić na pendrivie
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
const dataDir = process.env.QR_DATA_DIR || (portableDir ? path.join(portableDir, 'QR - dane') : path.join(app.getPath('userData'), 'dane'));
const shotsDir = process.env.QR_SHOTS;

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let blocker = null;
const KEYS = { prefs: 'ustawienia.json', history: 'historia.json' };

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const iconPath = () => path.join(__dirname, '..', 'assets', 'icon.png');
const emit = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

function createWindow() {
  const isMac = process.platform === 'darwin';
  const wa = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1120, wa.width - 80),
    height: Math.min(780, wa.height - 60),
    minWidth: 380,
    minHeight: 560,
    show: false,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#f2f2f7',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });
  win.setMenuBarVisibility(false);
  // QR_PAGE (tylko tryb deweloperski): np. „odbior.html#s=…” – podgląd strony odbioru
  const [page, hash] = (shotsDir && process.env.QR_PAGE ? process.env.QR_PAGE : 'index.html').split('#');
  win.loadFile(path.join(__dirname, '..', 'renderer', path.basename(page)), hash ? { hash } : undefined);
  win.once('ready-to-show', () => win.show());
  if (shotsDir) {
    win.webContents.on('console-message', (...a) => { const e = a[0]; console.log('[renderer]', e && e.message ? e.message : a.slice(1).join(' ')); });
    win.webContents.once('did-finish-load', () => devScreenshots(shotsDir));
  }
  win.on('maximize', () => emit('window:state', { maximized: true }));
  win.on('unmaximize', () => emit('window:state', { maximized: false }));
  win.on('blur', () => emit('window:state', { focused: false }));
  win.on('focus', () => emit('window:state', { focused: true }));
  // linki (np. odczytane z kodu QR) otwieramy w przeglądarce systemowej, nigdy w oknie aplikacji
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// Tryb deweloperski: zrzuty ekranu kolejnych widoków (QR_SHOTS=katalog, QR_STEPS="nazwa=JS,…")
async function devScreenshots(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync(dir, { recursive: true });
  const steps = (process.env.QR_STEPS || 'start').split(',');
  await wait(1200);
  for (const step of steps) {
    const [name, js] = step.split('=');
    if (js) await win.webContents.executeJavaScript(decodeURIComponent(js)).catch((e) => console.error(e));
    await wait(Number(process.env.QR_WAIT || 1100));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
  }
  app.quit();
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ─────────────────────────── IPC ───────────────────────────
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

const safeName = (n) => String(n || 'plik').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').slice(0, 150) || 'plik';
const extFilter = (name) => {
  const ext = path.extname(name).slice(1).toLowerCase();
  return ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'Wszystkie pliki', extensions: ['*'] }] : [];
};

function registerIpc() {
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dataDir, portable: !!portableDir }));

  handle('window:control', (action) => {
    if (!win) return false;
    if (action === 'close') { win.close(); return false; }
    if (action === 'minimize') { win.minimize(); return win.isMaximized(); }
    if (action === 'maximize') {
      const target = !win.isMaximized();
      if (target) win.maximize(); else win.unmaximize();
      return target;
    }
    return win.isMaximized();
  });

  handle('store:read', (key) => {
    if (!KEYS[key]) throw new Error('Nieznany klucz.');
    const f = path.join(dataDir, KEYS[key]);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  });

  handle('store:write', (key, value) => {
    if (!KEYS[key]) throw new Error('Nieznany klucz.');
    const f = path.join(dataDir, KEYS[key]);
    if (value == null) { try { fs.unlinkSync(f); } catch (_) { /* brak */ } return true; }
    writeAtomic(f, String(value));
    return true;
  });

  handle('clipboard:writeText', (text) => { clipboard.writeText(String(text)); return true; });
  handle('clipboard:readText', () => clipboard.readText());
  handle('clipboard:readImage', () => { const img = clipboard.readImage(); return img.isEmpty() ? null : img.toDataURL(); });
  handle('clipboard:writeImage', (b64) => { clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(b64, 'base64'))); return true; });

  handle('file:save', async (name, b64) => {
    name = safeName(name);
    const r = await dialog.showSaveDialog(win, { title: 'Zapisz plik', defaultPath: path.join(app.getPath('downloads'), name), filters: extFilter(name) });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, Buffer.from(b64, 'base64'));
    return r.filePath;
  });

  handle('file:saveMany', async (files) => {
    const r = await dialog.showOpenDialog(win, { title: 'Wybierz folder na odebrane pliki', defaultPath: app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = r.filePaths[0];
    for (const f of files) {
      const base = safeName(f.name);
      let target = path.join(dir, base), i = 1;
      while (fs.existsSync(target)) { const ext = path.extname(base); target = path.join(dir, `${path.basename(base, ext)} (${i++})${ext}`); }
      fs.writeFileSync(target, Buffer.from(f.data, 'base64'));
    }
    return dir;
  });

  handle('screen:capture', async () => {
    const displays = screen.getAllDisplays();
    const w = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)));
    const h = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)));
    const wasVisible = win.isVisible() && !win.isMinimized();
    if (wasVisible) win.setOpacity(0);
    await new Promise((r) => setTimeout(r, 250));
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
      return sources.map((s) => s.thumbnail.toDataURL());
    } finally {
      if (wasVisible) win.setOpacity(1);
    }
  });

  // Ekran nie gaśnie i system nie usypia w czasie transmisji
  handle('power:keepAwake', (on) => {
    if (on && blocker == null) blocker = powerSaveBlocker.start('prevent-display-sleep');
    else if (!on && blocker != null) { powerSaveBlocker.stop(blocker); blocker = null; }
    return !!on;
  });

  handle('shell:openExternal', (url) => { if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url); });
}

app.on('second-instance', () => showWindow());

app.whenReady().then(async () => {
  fs.mkdirSync(dataDir, { recursive: true });
  // macOS: zgoda systemu na kamerę (skanowanie i odbiór transmisji)
  if (process.platform === 'darwin') { try { await systemPreferences.askForMediaAccess('camera'); } catch (_) { /* brak */ } }
  // tylko kamera, schowek i blokada wygaszania – reszta uprawnień zablokowana
  const allowed = ['media', 'clipboard-read', 'clipboard-sanitized-write', 'screen-wake-lock'];
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    if (permission === 'media' && details && details.mediaTypes && details.mediaTypes.includes('audio')) return cb(false);
    cb(allowed.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.includes(permission));
  registerIpc();
  createWindow();
  app.on('activate', showWindow);
});

app.on('window-all-closed', () => app.quit());
