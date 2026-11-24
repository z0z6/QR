'use strict';
// Warstwa platformy: ta sama aplikacja działa w Electronie (Windows/Linux/macOS), w Capacitorze
// (Android) i w zwykłej przeglądarce (wersja webowa / iPhone). Reszta kodu korzysta tylko z window.Platform.

(function () {
  const APP_VERSION = '1.0.1'; // musi być zgodna z package.json (sprawdza to test)
  const cap = window.Capacitor;
  const isElectron = !!window.api;
  const isAndroid = !isElectron && !!cap && cap.isNativePlatform && cap.isNativePlatform();
  const kind = isElectron ? 'electron' : isAndroid ? 'android' : 'web';

  const plugin = (name) => {
    cap.Plugins = cap.Plugins || {};
    return cap.Plugins[name] || cap.registerPlugin(name);
  };
  const P = isAndroid ? {
    prefs: plugin('Preferences'),
    clip: plugin('Clipboard'),
    fs: plugin('Filesystem'),
    share: plugin('Share'),
    bars: plugin('SystemBars'),
    device: plugin('QrDevice') // własna wtyczka: ekran włączony, jasność, „Udostępnij do QR”
  } : {};

  // ───── magazyn (ustawienia, historia) ─────
  async function readKey(key) {
    if (isElectron) return window.api.read(key);
    if (isAndroid) return (await P.prefs.get({ key })).value || null;
    try { return localStorage.getItem('qr.' + key); } catch (_) { return null; }
  }
  async function writeKey(key, value) {
    if (isElectron) return window.api.write(key, value);
    if (isAndroid) return value == null ? P.prefs.remove({ key }) : P.prefs.set({ key, value });
    try { value == null ? localStorage.removeItem('qr.' + key) : localStorage.setItem('qr.' + key, value); } catch (_) { /* tryb prywatny */ }
  }
  const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } };

  // ───── bajty ↔ base64 ─────
  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromBase64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (typeof data === 'string') return new TextEncoder().encode(data);
    return new Uint8Array(data);
  }
  const safeName = (n) => String(n || 'plik').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150) || 'plik';

  let wakeLock = null;

  const Platform = {
    kind,
    isElectron,
    isAndroid,
    isMobile: isAndroid || (!isElectron && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) || (!isElectron && navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)),
    isIOS: !isElectron && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))),
    canScanScreen: isElectron,
    toBase64,
    fromBase64,

    async info() {
      if (isElectron) return window.api.info();
      return { version: APP_VERSION, platform: kind };
    },

    async loadPrefs() { return parse(await readKey('prefs')) || {}; },
    async savePrefs(obj) { return writeKey('prefs', JSON.stringify(obj)); },
    async loadHistory() { return parse(await readKey('history')) || []; },
    async saveHistory(list) { return writeKey('history', list && list.length ? JSON.stringify(list) : null); },

    async copyText(text) {
      if (isElectron) return window.api.copyText(text);
      if (isAndroid) return P.clip.write({ string: text });
      return navigator.clipboard.writeText(text);
    },

    async readText() {
      if (isElectron) return window.api.readText();
      if (isAndroid) { const r = await P.clip.read(); return r && r.type && !/text/.test(r.type) ? '' : (r.value || ''); }
      return navigator.clipboard.readText();
    },

    // Obraz ze schowka (Electron/przeglądarka) – Blob albo null
    async readImage() {
      if (isElectron) { const d = await window.api.readImage(); return d ? await (await fetch(d)).blob() : null; }
      if (!navigator.clipboard || !navigator.clipboard.read) return null;
      for (const item of await navigator.clipboard.read()) {
        const t = item.types.find((x) => x.startsWith('image/'));
        if (t) return item.getType(t);
      }
      return null;
    },

    canCopyImage: isElectron || (!isAndroid && typeof ClipboardItem !== 'undefined'),
    async copyImage(pngBlob) {
      if (isElectron) return window.api.copyImage(toBase64(await toBytes(pngBlob)));
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
    },

    // Zapis pliku. Electron: okno „Zapisz jako”; Android: arkusz udostępniania; przeglądarka: pobranie
    // (na iPhonie i Androidzie – arkusz udostępniania, z którego można zapisać w Plikach lub Zdjęciach).
    async saveFile(name, data, type) {
      name = safeName(name);
      const bytes = await toBytes(data);
      if (isElectron) return window.api.saveFile(name, toBase64(bytes));
      if (isAndroid) {
        const r = await P.fs.writeFile({ path: name, data: toBase64(bytes), directory: 'CACHE' });
        try { await P.share.share({ title: name, dialogTitle: 'Zapisz lub wyślij plik', url: r.uri }); }
        finally { setTimeout(() => P.fs.deleteFile({ path: name, directory: 'CACHE' }).catch(() => {}), 120000); }
        return 'shared';
      }
      const blob = new Blob([bytes], { type: type || 'application/octet-stream' });
      if (Platform.isMobile && navigator.canShare) {
        const file = new File([blob], name, { type: blob.type });
        if (navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: name }); return 'shared'; }
          catch (e) { if (e && e.name === 'AbortError') return null; }
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      return name;
    },

    // Zapis wielu plików naraz (Electron: wybór folderu) – zwraca folder albo null
    canSaveMany: isElectron,
    async saveMany(files) {
      const list = [];
      for (const f of files) list.push({ name: safeName(f.name), data: toBase64(await toBytes(f.data)) });
      return window.api.saveMany(list);
    },

    canShare: isAndroid || (!isElectron && !!navigator.share),
    async shareText(text, title) {
      if (isAndroid) return P.share.share({ title: title || 'QR', text, dialogTitle: 'Udostępnij' });
      return navigator.share({ title: title || 'QR', text });
    },

    // Ekran nie gaśnie w czasie transmisji (i – na Androidzie – świeci najjaśniej przy nadawaniu)
    async keepAwake(on, bright) {
      try {
        if (isElectron) return await window.api.keepAwake(!!on);
        if (isAndroid) return await P.device.keepAwake({ on: !!on, bright: !!(on && bright) });
        if (on && navigator.wakeLock && !wakeLock) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.addEventListener('release', () => { wakeLock = null; });
        } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
      } catch (_) { /* brak obsługi – trudno */ }
    },

    // Android: treść przekazana przez „Udostępnij → QR” z innej aplikacji
    async takeShared() {
      if (!isAndroid) return null;
      try {
        const r = await P.device.takeShared();
        if (!r || (!r.text && !(r.files && r.files.length))) return null;
        return { text: r.text || '', files: (r.files || []).map((f) => ({ name: f.name, type: f.type, data: fromBase64(f.data) })) };
      } catch (_) { return null; }
    },

    async captureScreens() { return isElectron ? window.api.captureScreens() : []; },

    openExternal(url) {
      if (isElectron) return window.api.openExternal(url);
      window.open(url, '_blank', 'noopener');
    },

    windowControl(action) { return isElectron ? window.api.windowControl(action) : null; },

    setBarsStyle(dark) {
      if (!isAndroid) return;
      P.bars.setStyle({ style: dark == null ? 'DEFAULT' : dark ? 'DARK' : 'LIGHT' }).catch(() => {});
    },

    on(channel, fn) { return isElectron ? window.api.on(channel, fn) : () => {}; }
  };

  window.Platform = Platform;
  document.documentElement.classList.add('platform-' + kind);
  if (Platform.isMobile) document.documentElement.classList.add('mobile');
})();
