'use strict';
// Transmisja danych animowanymi kodami QR.
//
// Paczka (container):  [u32 długość opisu][opis JSON][zawartość plików jeden po drugim]
// Ładunek (payload):   [SHA-256 paczki, 32 B][paczka – po kompresji deflate, jeśli się opłaca]
// Ramka (jeden kod QR, Base45 w trybie alfanumerycznym):
//   0     magia 0xA7
//   1     wersja (4 bity) | flagi (bit 0 = kompresja)
//   2–5   identyfikator sesji (losowy)
//   6–9   długość ładunku L
//   10–11 rozmiar bloku B
//   12–15 numer symbolu (kod fontannowy)
//   16–17 CRC-16 nagłówka i danych
//   18…   B bajtów symbolu
// Każda ramka opisuje się sama, więc odbiorca może dołączyć w dowolnym momencie.
// Link startowy (pierwszy, zwykły kod QR) niesie w części po „#” identyfikator sesji
// i początek skrótu SHA-256 – odbiorca przyjmuje wyłącznie tę transmisję i na końcu
// sprawdza, czy dane są dokładnie tymi, które pokazał nadawca. Część po „#” nie jest
// wysyłana do serwera strony.

(function (root) {
  const Base45 = root.Base45 || (typeof require === 'function' ? require('./base45.js') : null);
  const Fountain = root.Fountain || (typeof require === 'function' ? require('./fountain.js') : null);

  const MAGIC = 0xa7;
  const VERSION = 1;
  const HEADER = 18;
  const HASH = 32;
  const FLAG_DEFLATE = 1;
  const MAX_TOTAL = 16 * 1024 * 1024;
  const DEFAULT_RECEIVER = 'https://z0z6.github.io/QR/odbior.html';

  // Pojemność kodu QR w trybie alfanumerycznym (znaki) dla wersji 1–40
  const CAPACITY = {
    L: [25, 47, 77, 114, 154, 195, 224, 279, 335, 395, 468, 535, 619, 667, 758, 854, 938, 1046, 1153, 1249, 1352, 1460, 1588, 1704, 1853, 1990, 2132, 2223, 2369, 2520, 2677, 2840, 3009, 3183, 3351, 3537, 3729, 3927, 4087, 4296],
    M: [20, 38, 61, 90, 122, 154, 178, 221, 262, 311, 366, 419, 483, 528, 600, 656, 734, 816, 909, 970, 1035, 1134, 1248, 1326, 1451, 1542, 1637, 1732, 1839, 1994, 2113, 2238, 2369, 2506, 2632, 2780, 2894, 3054, 3220, 3391],
    Q: [16, 29, 47, 67, 87, 108, 125, 157, 189, 221, 259, 296, 352, 376, 426, 470, 531, 574, 644, 702, 742, 823, 890, 963, 1041, 1094, 1172, 1263, 1322, 1429, 1499, 1618, 1700, 1787, 1867, 1966, 2071, 2181, 2298, 2420],
    H: [10, 20, 35, 50, 64, 84, 93, 122, 143, 174, 200, 227, 259, 283, 321, 365, 408, 452, 493, 557, 587, 640, 672, 744, 779, 864, 910, 958, 1016, 1080, 1150, 1226, 1307, 1394, 1431, 1530, 1591, 1658, 1774, 1852]
  };

  // Gotowe ustawienia prędkości: wersja kodu, poziom korekcji, klatki na sekundę
  const PRESETS = {
    safe: { label: 'Pewna', version: 16, ecc: 'M', fps: 8, hint: 'Słabszy aparat, drżąca ręka, jasne światło' },
    normal: { label: 'Zwykła', version: 20, ecc: 'L', fps: 10, hint: 'Dobra dla większości telefonów' },
    fast: { label: 'Szybka', version: 26, ecc: 'L', fps: 14, hint: 'Nowe telefony, ekran blisko aparatu' }
  };

  function blockSizeFor(version, ecc) {
    const chars = CAPACITY[ecc || 'L'][Math.max(1, Math.min(40, version)) - 1];
    return Math.max(16, Base45.maxBytes(chars) - HEADER);
  }

  // ───── CRC-16/CCITT-FALSE ─────
  const CRC_TABLE = (() => {
    const t = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i << 8;
      for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
      t[i] = c;
    }
    return t;
  })();
  function crc16(bytes, skipFrom, skipTo) {
    let c = 0xffff;
    for (let i = 0; i < bytes.length; i++) {
      if (i >= skipFrom && i < skipTo) continue;
      c = ((c << 8) & 0xffff) ^ CRC_TABLE[((c >> 8) ^ bytes[i]) & 0xff];
    }
    return c;
  }

  // ───── pomocnicze ─────
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const cryptoObj = () => (typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto);
  const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const fromHex = (hex) => new Uint8Array((hex.match(/../g) || []).map((x) => parseInt(x, 16)));
  async function sha256(bytes) { return new Uint8Array(await cryptoObj().subtle.digest('SHA-256', bytes)); }
  function randomU32() { const a = new Uint32Array(1); cryptoObj().getRandomValues(a); return a[0] >>> 0; }

  async function streamThrough(bytes, Stream) {
    const s = new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const canCompress = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

  function concat(parts) {
    const n = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // ───── paczka ─────
  // items: { kind: 'text', text } albo { kind: 'files', files: [{ name, type, data: Uint8Array }] }
  async function buildPayload(item) {
    let files, kind = item.kind;
    if (kind === 'text') files = [{ name: item.name || 'tekst.txt', type: 'text/plain;charset=utf-8', data: enc.encode(item.text) }];
    else files = item.files;
    if (!files || !files.length) throw new Error('Brak danych do wysłania.');
    const meta = { v: 1, k: kind, f: files.map((f) => ({ n: String(f.name || 'plik').slice(0, 200), t: f.type || 'application/octet-stream', s: f.data.length })) };
    const metaBytes = enc.encode(JSON.stringify(meta));
    const head = new Uint8Array(4);
    new DataView(head.buffer).setUint32(0, metaBytes.length);
    const container = concat([head, metaBytes, ...files.map((f) => f.data)]);
    if (container.length > MAX_TOTAL) throw new Error('Za dużo danych – limit jednej transmisji to 16 MB.');
    const hash = await sha256(container);
    let body = container, flags = 0;
    if (canCompress() && container.length > 64) {
      try {
        const z = await streamThrough(container, CompressionStream);
        if (z.length < container.length * 0.95) { body = z; flags |= FLAG_DEFLATE; }
      } catch (_) { /* bez kompresji */ }
    }
    return { payload: concat([hash, body]), flags, hash, hashHex: toHex(hash), meta, containerSize: container.length };
  }

  async function openPayload(payload, flags) {
    if (payload.length < HASH + 4) throw new Error('Uszkodzone dane.');
    const hash = payload.subarray(0, HASH);
    let container = payload.subarray(HASH);
    if (flags & FLAG_DEFLATE) {
      if (!canCompress()) throw new Error('Ta przeglądarka nie umie rozpakować danych – zaktualizuj ją.');
      container = await streamThrough(container, DecompressionStream);
    }
    const real = await sha256(container);
    if (toHex(real) !== toHex(hash)) throw new Error('Suma kontrolna się nie zgadza – dane są uszkodzone.');
    const metaLen = new DataView(container.buffer, container.byteOffset, 4).getUint32(0);
    const meta = JSON.parse(dec.decode(container.subarray(4, 4 + metaLen)));
    let o = 4 + metaLen;
    const files = meta.f.map((f) => {
      const data = container.slice(o, o + f.s);
      o += f.s;
      return { name: f.n, type: f.t, data };
    });
    const out = { kind: meta.k, files, hashHex: toHex(hash), size: container.length };
    if (meta.k === 'text') out.text = dec.decode(files[0].data);
    return out;
  }

  // ───── ramki ─────
  function packFrame(f) {
    const b = new Uint8Array(HEADER + f.payload.length);
    const v = new DataView(b.buffer);
    b[0] = MAGIC;
    b[1] = (VERSION << 4) | (f.flags & 15);
    v.setUint32(2, f.session >>> 0);
    v.setUint32(6, f.length >>> 0);
    v.setUint16(10, f.blockSize);
    v.setUint32(12, f.id >>> 0);
    b.set(f.payload, HEADER);
    v.setUint16(16, crc16(b, 16, 18));
    return Base45.encode(b);
  }

  function parseFrame(text) {
    if (typeof text !== 'string' || text.length < 30 || text.length > 5000) return null;
    const b = Base45.decode(text);
    if (!b || b.length < HEADER + 1 || b[0] !== MAGIC || (b[1] >> 4) !== VERSION) return null;
    const v = new DataView(b.buffer, b.byteOffset, b.length);
    if (v.getUint16(16) !== crc16(b, 16, 18)) return null;
    const blockSize = v.getUint16(10);
    if (b.length !== HEADER + blockSize) return null;
    return {
      flags: b[1] & 15,
      session: v.getUint32(2),
      length: v.getUint32(6),
      blockSize,
      id: v.getUint32(12),
      payload: b.subarray(HEADER)
    };
  }

  // ───── nadawca ─────
  class Sender {
    constructor(built, opts = {}) {
      this.flags = built.flags;
      this.session = opts.session != null ? opts.session : randomU32();
      this.setQuality(opts.version || 20, opts.ecc || 'L');
      this.payload = built.payload;
      this.next = 0;
      this.sent = 0;
      this._build();
    }
    setQuality(version, ecc) {
      this.version = version;
      this.ecc = ecc;
      const B = blockSizeFor(version, ecc);
      if (this.blockSize && this.blockSize !== B) { this.blockSize = B; this._build(); }
      this.blockSize = B;
    }
    _build() {
      if (!this.payload) return;
      this.encoder = new Fountain.Encoder(this.payload, this.blockSize);
      this.K = this.encoder.K;
      // nowy rozmiar bloku = nowe symbole; numeracja od zera (odbiorca zaczyna wtedy od nowa)
      this.next = 0;
    }
    // Kolejna ramka: najpierw wszystkie bloki po kolei, potem już tylko symbole fontannowe
    nextFrame() {
      const id = this.next++;
      this.sent++;
      return packFrame({ flags: this.flags, session: this.session, length: this.payload.length, blockSize: this.blockSize, id, payload: this.encoder.symbol(id) });
    }
    get rounds() { return this.sent / this.K; }
  }

  // ───── odbiorca ─────
  class Receiver {
    // opts.session – przyjmuj tylko tę sesję (z linku startowego); opts.hash – oczekiwany początek SHA-256
    constructor(opts = {}) {
      this.expectSession = opts.session != null ? opts.session >>> 0 : null;
      this.expectHash = opts.hash ? String(opts.hash).toLowerCase() : null;
      this.reset();
    }
    reset() {
      this.decoder = null;
      this.session = null;
      this.flags = 0;
      this.frames = 0;
      this.useful = 0;
      this.startedAt = 0;
      this.lastAt = 0;
      this.result = null;
      this.error = null;
    }
    // Zwraca: 'frame' (nowa ramka), 'dup', 'other' (inna sesja), 'not-frame', 'done'
    feed(text) {
      const f = parseFrame(text);
      if (!f) return 'not-frame';
      if (this.expectSession != null && f.session !== this.expectSession) return 'other';
      if (this.result || this.error) return 'done';
      if (f.length < HASH + 4 || f.length > MAX_TOTAL * 1.1) return 'other';
      const now = Date.now();
      if (!this.decoder || this.session !== f.session || this.decoder.B !== f.blockSize || this.decoder.L !== f.length) {
        // pierwsza ramka albo nadawca zmienił prędkość (inny rozmiar bloku) – zaczynamy od nowa
        const keepStart = this.decoder && this.session === f.session ? this.startedAt : now;
        this.session = f.session;
        this.flags = f.flags;
        this.decoder = new Fountain.Decoder(Math.ceil(f.length / f.blockSize), f.blockSize, f.length);
        this.startedAt = keepStart;
      }
      this.frames++;
      this.lastAt = now;
      const fresh = this.decoder.add(f.id, f.payload);
      if (fresh) this.useful++;
      return fresh ? 'frame' : 'dup';
    }
    get progress() { return this.decoder ? this.decoder.progress : 0; }
    get total() { return this.decoder ? this.decoder.L : 0; }
    get complete() { return !!(this.decoder && this.decoder.done); }
    // Średnia prędkość (bajty/s) liczona od pierwszej ramki
    get speed() {
      if (!this.decoder || !this.startedAt) return 0;
      const s = Math.max(0.5, (this.lastAt - this.startedAt) / 1000);
      return (this.decoder.knownCount * this.decoder.B) / s;
    }
    async finish() {
      if (this.result) return this.result;
      const payload = this.decoder.result();
      const out = await openPayload(payload, this.flags);
      if (this.expectHash && !out.hashHex.startsWith(this.expectHash)) throw new Error('Odebrane dane nie pasują do linku startowego.');
      this.result = out;
      return out;
    }
  }

  // ───── link startowy ─────
  function sessionHex(n) { return (n >>> 0).toString(16).padStart(8, '0'); }

  function buildLink(base, info) {
    const p = new URLSearchParams();
    p.set('s', sessionHex(info.session));
    p.set('h', String(info.hashHex).slice(0, 32));
    if (info.name) p.set('n', String(info.name).slice(0, 80));
    if (info.bytes) p.set('b', String(info.bytes));
    if (info.count > 1) p.set('c', String(info.count));
    return (base || DEFAULT_RECEIVER).replace(/#.*$/, '') + '#' + p.toString();
  }

  // Przyjmuje pełny adres albo samą część po „#”. Zwraca null, gdy to nie link transmisji.
  function parseLink(text) {
    if (typeof text !== 'string') return null;
    const i = text.indexOf('#');
    const frag = i >= 0 ? text.slice(i + 1) : text;
    const p = new URLSearchParams(frag);
    const s = p.get('s'), h = p.get('h');
    if (!/^[0-9a-f]{8}$/i.test(s || '') || !/^[0-9a-f]{16,64}$/i.test(h || '')) return null;
    const bytes = Number(p.get('b')) || 0;
    return { session: parseInt(s, 16) >>> 0, hash: h.toLowerCase(), name: (p.get('n') || '').slice(0, 80), bytes, count: Number(p.get('c')) || 1, base: i >= 0 ? text.slice(0, i) : '' };
  }

  // Szacunkowa prędkość (bajty/s) – ok. 80% klatek trafia do odbiorcy
  function estimateSpeed(version, ecc, fps) { return blockSizeFor(version, ecc) * fps * 0.8; }

  function formatBytes(n) {
    if (!(n >= 0)) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toLocaleString('pl-PL', { maximumFractionDigits: n < 10240 ? 1 : 0 }) + ' KB';
    return (n / 1048576).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + ' MB';
  }
  function formatDuration(sec) {
    if (!isFinite(sec) || sec < 0) return '–';
    sec = Math.round(sec);
    if (sec < 60) return sec + ' s';
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return m + ' min' + (s ? ' ' + s + ' s' : '');
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }

  const Transfer = {
    MAGIC, VERSION, HEADER, CAPACITY, PRESETS, DEFAULT_RECEIVER, MAX_TOTAL,
    blockSizeFor, crc16, sha256, toHex, fromHex, randomU32,
    buildPayload, openPayload, packFrame, parseFrame, Sender, Receiver,
    buildLink, parseLink, sessionHex, estimateSpeed, formatBytes, formatDuration
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Transfer;
  else root.Transfer = Transfer;
})(typeof self !== 'undefined' ? self : this);
