'use strict';
// Kody QR: rysowanie (SVG z wyglądem: kolory, kropki, zaokrąglenia, logo, podpis), eksport do PNG,
// odczyt z obrazu i ciągłe skanowanie z aparatu (BarcodeDetector, gdy jest, inaczej jsQR).

(function () {
  const qrcode = window.qrcode;
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

  // ───────────── macierz ─────────────
  function matrix(text, ecc, mode) {
    const qr = qrcode(0, ecc || 'M');
    qr.addData(text, mode || 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    return { n, dark: (r, c) => qr.isDark(r, c), version: (n - 17) / 4 };
  }

  // Czy da się zakodować (bez rzucania wyjątku)
  function fits(text, ecc) {
    try { return matrix(text, ecc); } catch (_) { return null; }
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ───────────── rysowanie SVG ─────────────
  // opts: { ecc, fg, bg, style: square|rounded|dots, eyes: square|rounded|circle, margin, logo (data URL), logoScale, caption }
  function svg(text, opts = {}) {
    const ecc = opts.logo ? (opts.ecc === 'Q' ? 'Q' : 'H') : (opts.ecc || 'M');
    const m = matrix(text, ecc);
    const n = m.n;
    const q = opts.margin != null ? opts.margin : 4;
    const fg = opts.fg || '#000000', bg = opts.bg || '#ffffff';
    const style = opts.style || 'square', eyes = opts.eyes || 'square';
    const capH = opts.caption ? Math.max(4, Math.round(n * 0.11)) : 0;
    const W = n + 2 * q, H = W + capH;
    const inEye = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

    // obszar logo (wolny od modułów)
    let lo = null;
    if (opts.logo) {
      const s = Math.round(n * Math.min(0.26, Math.max(0.12, opts.logoScale || 0.22)));
      const size = s % 2 === n % 2 ? s : s + 1;
      const a = (n - size) / 2;
      lo = { a, b: a + size, size };
    }
    const inLogo = (r, c) => lo && r >= lo.a - 0.5 && r < lo.b + 0.5 && c >= lo.a - 0.5 && c < lo.b + 0.5;

    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!m.dark(r, c) || inEye(r, c) || inLogo(r, c)) continue;
        const x = c + q, y = r + q;
        if (style === 'dots') d += `M${x + 0.5} ${y + 0.03}a.47 .47 0 1 1 0 .94a.47 .47 0 1 1 0-.94z`;
        else if (style === 'rounded') d += roundedModule(m, n, r, c, x, y);
        else d += `M${x} ${y}h1v1h-1z`;
      }
    }
    let eyesSvg = '';
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      const x = c0 + q, y = r0 + q;
      if (eyes === 'circle') {
        eyesSvg += `<circle cx="${x + 3.5}" cy="${y + 3.5}" r="3" fill="none" stroke="${fg}" stroke-width="1"/><circle cx="${x + 3.5}" cy="${y + 3.5}" r="1.5" fill="${fg}"/>`;
      } else if (eyes === 'rounded') {
        eyesSvg += `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.8" fill="none" stroke="${fg}" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${fg}"/>`;
      } else {
        eyesSvg += `<path d="M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5z" fill="${fg}" fill-rule="evenodd"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="${fg}"/>`;
      }
    }
    let logoSvg = '';
    if (lo) {
      const pad = 0.35;
      logoSvg = `<rect x="${lo.a + q - pad}" y="${lo.a + q - pad}" width="${lo.size + 2 * pad}" height="${lo.size + 2 * pad}" rx="${lo.size * 0.18}" fill="${bg}"/>` +
        `<image href="${esc(opts.logo)}" x="${lo.a + q + 0.4}" y="${lo.a + q + 0.4}" width="${lo.size - 0.8}" height="${lo.size - 0.8}" preserveAspectRatio="xMidYMid meet"/>`;
    }
    let capSvg = '';
    if (capH) {
      const fs = Math.min(capH * 0.62, (W * 1.7) / Math.max(8, opts.caption.length));
      capSvg = `<text x="${W / 2}" y="${W + capH * 0.42}" font-family="Inter, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="${fs.toFixed(2)}" font-weight="600" fill="${fg}" text-anchor="middle" dominant-baseline="middle">${esc(opts.caption)}</text>`;
    }
    const rendering = style === 'square' && eyes === 'square' ? ' shape-rendering="crispEdges"' : '';
    const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 10}" height="${H * 10}"${rendering}>` +
      `<rect width="${W}" height="${H}" fill="${bg}"/><path d="${d}" fill="${fg}"/>${eyesSvg}${logoSvg}${capSvg}</svg>`;
    return { svg: out, modules: n, version: m.version, ecc, width: W, height: H };
  }

  // Moduł z zaokrąglonymi rogami tam, gdzie nie ma sąsiada (płynne „kapsułki”)
  function roundedModule(m, n, r, c, x, y) {
    const on = (rr, cc) => rr >= 0 && cc >= 0 && rr < n && cc < n && m.dark(rr, cc);
    const t = on(r - 1, c), b = on(r + 1, c), l = on(r, c - 1), rt = on(r, c + 1);
    const k = 0.42;
    const tl = !t && !l ? k : 0, tr = !t && !rt ? k : 0, br = !b && !rt ? k : 0, bl = !b && !l ? k : 0;
    return `M${x + tl} ${y}h${1 - tl - tr}` + (tr ? `a${tr} ${tr} 0 0 1 ${tr} ${tr}` : '') +
      `v${1 - tr - br}` + (br ? `a${br} ${br} 0 0 1 ${-br} ${br}` : '') +
      `h${-(1 - br - bl)}` + (bl ? `a${bl} ${bl} 0 0 1 ${-bl} ${-bl}` : '') +
      `v${-(1 - bl - tl)}` + (tl ? `a${tl} ${tl} 0 0 1 ${tl} ${-tl}` : '') + 'z';
  }

  // SVG → PNG (Blob) o zadanej szerokości w pikselach
  async function png(svgText, width) {
    const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText));
    const ratio = (img.naturalHeight || 1) / (img.naturalWidth || 1);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round(width * ratio);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }

  // Szybkie rysowanie ramki transmisji na płótnie (bez SVG): czarne na białym, ostre piksele
  function drawToCanvas(canvas, text, version, ecc, quiet = 3) {
    const qr = qrcode(version, ecc);
    qr.addData(text, 'Alphanumeric');
    qr.make();
    const n = qr.getModuleCount();
    const total = n + quiet * 2;
    const px = Math.max(1, Math.floor(canvas.width / total));
    const off = Math.floor((canvas.width - px * total) / 2) + quiet * px;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) {
      let run = -1;
      for (let c = 0; c <= n; c++) {
        const dark = c < n && qr.isDark(r, c);
        if (dark && run < 0) run = c;
        else if (!dark && run >= 0) { ctx.fillRect(off + run * px, off + r * px, (c - run) * px, px); run = -1; }
      }
    }
    return n;
  }

  // ───────────── odczyt ─────────────
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Nie udało się wczytać obrazu.'));
      img.src = src;
    });
  }

  function decodeCanvas(canvas, invert = 'attemptBoth') {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: invert });
    return r ? r.data : null;
  }

  // Kilka skal: małe kody na dużych zrzutach wymagają pełnej rozdzielczości, zdjęcia – zmniejszenia
  async function decodeImageSource(src) {
    const img = await loadImage(src);
    const w = img.naturalWidth, hgt = img.naturalHeight;
    const scales = [1, 1600 / Math.max(w, hgt), 800 / Math.max(w, hgt), 480 / Math.max(w, hgt)].filter((s, i, a) => s <= 1 && a.indexOf(s) === i);
    if (!scales.length) scales.push(1);
    for (const s of scales) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * s));
      c.height = Math.max(1, Math.round(hgt * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const text = decodeCanvas(c);
      if (text) return text;
      await new Promise((r) => setTimeout(r, 0));
    }
    return null;
  }

  async function decodeBlob(blob) {
    const url = URL.createObjectURL(blob);
    try { return await decodeImageSource(url); } finally { URL.revokeObjectURL(url); }
  }

  // ───────────── ciągłe skanowanie z aparatu ─────────────
  // Camera.start(video, onText, { facing, deviceId }) → { stop(), switch(), devices }
  let detectorPromise = null;
  function getDetector() {
    if (detectorPromise) return detectorPromise;
    detectorPromise = (async () => {
      try {
        if (!('BarcodeDetector' in window)) return null;
        const formats = await window.BarcodeDetector.getSupportedFormats();
        return formats.includes('qr_code') ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
      } catch (_) { return null; }
    })();
    return detectorPromise;
  }

  async function startCamera(video, onText, opts = {}) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('To urządzenie lub przeglądarka nie udostępnia aparatu.'), { code: 'nocamera' });
    let stream = null, stopped = false, timer = null, facing = opts.facing || 'environment', deviceId = opts.deviceId || null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const detector = await getDetector();
    const stats = { decoded: 0, frames: 0, engine: detector ? 'BarcodeDetector' : 'jsQR' };

    async function open() {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      const video_ = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } };
      Object.assign(video_, { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } });
      try { stream = await navigator.mediaDevices.getUserMedia({ video: video_, audio: false }); }
      catch (e) {
        if (e && e.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        else throw e;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.muted = true;
      await video.play().catch(() => {});
      // ostrość ciągła, jeśli aparat pozwala
      const track = stream.getVideoTracks()[0];
      try {
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.focusMode && caps.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } catch (_) { /* brak */ }
    }

    async function tick() {
      if (stopped) return;
      const t0 = performance.now();
      let text = null;
      if (video.readyState >= 2 && video.videoWidth) {
        stats.frames++;
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes && codes.length) text = codes[0].rawValue;
          } else {
            // środkowy kwadrat obrazu, zmniejszony do ≤ 900 px – kod i tak jest pośrodku
            const vw = video.videoWidth, vh = video.videoHeight;
            const side = Math.min(vw, vh);
            const s = Math.min(1, 900 / side);
            canvas.width = canvas.height = Math.round(side * s);
            ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: opts.invert || 'attemptBoth' });
            if (r) text = r.data;
          }
        } catch (_) { /* pojedyncza klatka – pomijamy */ }
      }
      if (text) { stats.decoded++; try { onText(text); } catch (e) { console.error(e); } }
      if (stopped) return;
      const spent = performance.now() - t0;
      timer = setTimeout(tick, Math.max(0, (opts.interval || 0) - spent));
    }

    await open();
    tick();

    return {
      stats,
      stop() {
        stopped = true;
        clearTimeout(timer);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      },
      async switchCamera() {
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        if (devices.length < 2) return false;
        const cur = stream && stream.getVideoTracks()[0] && stream.getVideoTracks()[0].getSettings().deviceId;
        const i = devices.findIndex((d) => d.deviceId === cur);
        deviceId = devices[(i + 1) % devices.length].deviceId;
        await open();
        return true;
      }
    };
  }

  function cameraError(err) {
    if (err && err.code === 'nocamera') return err.message;
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) return 'Brak zgody na użycie aparatu. Zezwól na dostęp w ustawieniach przeglądarki lub systemu i spróbuj ponownie.';
    if (err && err.name === 'NotReadableError') return 'Aparat jest zajęty przez inną aplikację.';
    return 'Nie znaleziono aparatu.';
  }

  // Wybór plików (wiele naraz)
  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      if (multiple) input.multiple = true;
      input.style.display = 'none';
      input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
      input.addEventListener('cancel', () => { resolve([]); input.remove(); });
      document.body.appendChild(input);
      input.click();
    });
  }

  window.QR = { matrix, fits, svg, png, drawToCanvas, loadImage, decodeImageSource, decodeBlob, startCamera, cameraError, pickFiles, getDetector };
})();
