'use strict';
// Aplikacja QR – generator kodów, nadajnik i odbiornik transmisji. Wspólny interfejs
// dla Windows, Linuksa, macOS (Electron), Androida (Capacitor) i przeglądarki (iPhone, inne).

(function () {
  const { h, iconEl, toast, sheet, confirm, toggle, segmented, select, group, row, busy, pushLayer, dropLayer } = window.UI;
  const P = window.Platform;
  const T = window.Transfer;
  const C = window.Content;
  const $view = document.getElementById('screen');

  const DEFAULT_LOOK = { ecc: 'M', style: 'square', eyes: 'square', fg: '#000000', bg: '#ffffff', margin: 4, caption: '', exportSize: 1024, logoScale: 0.22 };
  const DEFAULT_PREFS = { theme: 'system', tab: 'gen', receiverUrl: T.DEFAULT_RECEIVER, speed: 'normal', custom: null, history: true, look: { ...DEFAULT_LOOK } };
  const S = {
    prefs: JSON.parse(JSON.stringify(DEFAULT_PREFS)),
    info: {},
    history: [],
    gen: { type: 'text', fields: { text: { text: '' } }, logo: null },
    send: { mode: 'files', files: [], text: '' },
    tab: 'gen',
    rx: null
  };

  const TABS = [
    { id: 'gen', label: 'Generuj', icon: 'qr' },
    { id: 'send', label: 'Prześlij', icon: 'send' },
    { id: 'recv', label: 'Odbierz', icon: 'inbox' },
    { id: 'settings', label: 'Ustawienia', icon: 'gear' }
  ];

  // ───────────────────────── pomocnicze ─────────────────────────
  const fmtB = T.formatBytes;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const readText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Nie udało się odczytać pliku.')); r.readAsText(file); });
  const readDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Nie udało się odczytać pliku.')); r.readAsDataURL(file); });
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

  async function savePrefs(patch) {
    Object.assign(S.prefs, patch);
    await P.savePrefs(S.prefs);
  }
  const look = () => S.prefs.look;
  async function saveLook(patch) { Object.assign(S.prefs.look, patch); await P.savePrefs(S.prefs); }

  function applyTheme() {
    const t = S.prefs.theme;
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    P.setBarsStyle(t === 'system' ? null : t === 'dark');
  }

  function field(label, control, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
  }
  function card(...children) { return h('section', { class: 'card' }, children); }
  function pageHead(title, sub, extra) {
    return h('header', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('p', { class: 'muted' }, sub) : null), extra || null);
  }

  // Luminancja i kontrast kolorów (WCAG) – ostrzeżenie przed nieczytelnym kodem
  function lum(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  // ───────────────────────── okno (Electron) ─────────────────────────
  function setupTitlebar() {
    const bar = document.getElementById('titlebar');
    if (!P.isElectron) { bar.remove(); document.body.classList.add('no-titlebar'); return; }
    if (S.info.platform === 'darwin') { document.documentElement.classList.add('platform-darwin'); return; }
    document.getElementById('traffic').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const max = await P.windowControl(b.dataset.act);
      document.body.classList.toggle('maximized', !!max);
    });
    bar.addEventListener('dblclick', async (e) => {
      if (e.target.closest('.traffic')) return;
      document.body.classList.toggle('maximized', !!(await P.windowControl('maximize')));
    });
    P.on('window:state', (s) => {
      if (s.maximized != null) document.body.classList.toggle('maximized', s.maximized);
      if (s.focused != null) document.body.classList.toggle('window-blur', !s.focused);
    });
  }

  // ───────────────────────── start ─────────────────────────
  async function init() {
    try { S.info = await P.info(); } catch (_) { S.info = {}; }
    setupTitlebar();
    const saved = await P.loadPrefs();
    S.prefs = { ...JSON.parse(JSON.stringify(DEFAULT_PREFS)), ...saved, look: { ...DEFAULT_LOOK, ...(saved.look || {}) } };
    S.history = S.prefs.history ? await P.loadHistory() : [];
    applyTheme();
    renderShell();
    go(TABS.some((t) => t.id === S.prefs.tab) ? S.prefs.tab : 'gen');
    checkShared();
    setupDrop();
    if (P.kind === 'web' && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    // adres strony z linkiem transmisji (np. otwarty w wersji webowej) – od razu odbiór
    const link = T.parseLink(location.hash);
    if (link) openReceiver({ link });
  }

  function renderShell() {
    const nav = h('nav', { class: 'tabbar', id: 'tabbar' },
      h('div', { class: 'tabbar-brand' }, h('span', { class: 'brand-logo', html: window.icon('qr', 20) }), h('b', null, 'QR')),
      TABS.map((t) => h('button', { class: 'tab', 'data-tab': t.id, type: 'button', onclick: () => go(t.id) }, iconEl(t.icon, 22), h('span', null, t.label))));
    const view = h('div', { class: 'view', id: 'view' });
    $view.replaceChildren(h('div', { class: 'shell' }, nav, view));
  }

  function go(tab) {
    if (S.rx && tab !== 'recv') { S.rx.stop(); S.rx = null; }
    S.tab = tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (S.prefs.tab !== tab) savePrefs({ tab });
    const view = document.getElementById('view');
    view.scrollTop = 0;
    if (tab === 'gen') renderGenerator(view);
    else if (tab === 'send') renderSend(view);
    else if (tab === 'recv') renderReceive(view);
    else renderSettings(view);
  }

  // ═════════════════════════ GENERATOR ═════════════════════════
  function genText() {
    const t = S.gen.type;
    return C.build(t, S.gen.fields[t] || {});
  }

  let genPreview = null; // funkcja odświeżająca podgląd

  function renderGenerator(view) {
    const chips = h('div', { class: 'chips', role: 'tablist' }, C.TYPES.map((t) => h('button', {
      class: 'chip' + (t.id === S.gen.type ? ' active' : ''), type: 'button',
      onclick: () => { S.gen.type = t.id; renderGenerator(view); }
    }, iconEl(t.icon, 15), t.label)));

    const editor = S.gen.type === 'text' ? pasteBox() : formFor(S.gen.type);
    const preview = h('div', { class: 'gen-preview' });
    const histBox = h('div', { class: 'gen-history' });

    view.replaceChildren(h('div', { class: 'page' },
      pageHead('Generuj kod QR', 'Link, tekst, wizytówka, Wi-Fi i inne – kod gotowy do wydruku lub zeskanowania.'),
      h('div', { class: 'gen' },
        h('div', { class: 'gen-editor' }, chips, card(editor), lookPanel()),
        h('div', { class: 'gen-side' }, preview, histBox))));

    genPreview = debounce(() => paintPreview(preview), 90);
    paintPreview(preview);
    paintHistory(histBox);
    const first = view.querySelector('.gen-editor textarea, .gen-editor input');
    if (first && !P.isMobile) setTimeout(() => first.focus(), 30);
  }

  // Duże okno do wklejenia linku, tekstu albo całej wizytówki
  function pasteBox() {
    const f = S.gen.fields.text || (S.gen.fields.text = { text: '' });
    const ta = h('textarea', { class: 'paste', rows: 6, placeholder: 'Wklej albo wpisz link do strony, tekst lub wizytówkę (vCard)…', spellcheck: 'false', value: f.text });
    const badge = h('div', { class: 'detect' });
    const count = h('span', { class: 'paste-count muted' });
    const update = () => {
      f.text = ta.value;
      const d = C.detect(ta.value);
      badge.replaceChildren();
      if (d.type !== 'empty') {
        const ic = { url: 'globe', vcard: 'person', wifi: 'wifi', email: 'mail', sms: 'message', tel: 'phone', geo: 'mapPin', event: 'calendar', otp: 'key', text: 'text' }[d.type] || 'text';
        const name = { url: 'Link', vcard: 'Wizytówka', wifi: 'Sieć Wi-Fi', email: 'E-mail', sms: 'SMS', tel: 'Telefon', geo: 'Miejsce', event: 'Wydarzenie', otp: 'Klucz 2FA', text: 'Tekst' }[d.type];
        badge.append(iconEl(ic, 16), h('div', null, h('b', null, name + (d.title && d.type !== 'text' ? ': ' + d.title : '')), d.type !== 'text' && d.detail && d.detail !== d.title ? h('span', { class: 'muted' }, d.detail) : null));
        if (d.type === 'vcard' && /^BEGIN:VCARD/i.test(ta.value.trim())) badge.append(h('button', { class: 'btn', type: 'button', onclick: () => { S.gen.fields.vcard = C.vcardToFields(ta.value); S.gen.type = 'vcard'; renderGenerator(document.getElementById('view')); } }, iconEl('pencil', 14), 'Edytuj w formularzu'));
        if (d.type === 'wifi') badge.append(h('button', { class: 'btn', type: 'button', onclick: () => { S.gen.fields.wifi = C.parseWifi(ta.value.trim()); S.gen.type = 'wifi'; renderGenerator(document.getElementById('view')); } }, iconEl('pencil', 14), 'Edytuj'));
      }
      badge.style.display = d.type === 'empty' ? 'none' : '';
      count.textContent = ta.value ? `${C.byteLength(ta.value).toLocaleString('pl-PL')} B` : '';
      if (genPreview) genPreview();
    };
    ta.addEventListener('input', update);
    ta.addEventListener('drop', async (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      await loadFileIntoBox(file, ta, update);
    });
    const tools = h('div', { class: 'paste-tools' },
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        try {
          const t = await P.readText();
          if (t) { ta.value = t; update(); ta.focus(); return; }
          const img = await P.readImage().catch(() => null);
          if (img) { const txt = await window.QR.decodeBlob(img); if (txt) { ta.value = txt; update(); toast('Odczytano kod QR ze schowka.', 'success'); return; } }
          toast('Schowek jest pusty.');
        } catch (_) { toast('Brak dostępu do schowka – wklej skrótem Ctrl+V / przytrzymaj pole.', 'error'); }
      } }, iconEl('paste', 15), 'Wklej'),
      h('button', { class: 'btn', type: 'button', onclick: async () => { const [file] = await window.QR.pickFiles('.txt,.vcf,.ics,.csv,.md,.json,text/*,image/*'); if (file) await loadFileIntoBox(file, ta, update); } }, iconEl('import', 15), 'Wczytaj plik'),
      h('button', { class: 'btn plain', type: 'button', onclick: () => { ta.value = ''; update(); ta.focus(); } }, 'Wyczyść'),
      h('span', { class: 'spacer' }), count);
    setTimeout(update, 0);
    return h('div', { class: 'paste-wrap' }, ta, tools, badge);
  }

  async function loadFileIntoBox(file, ta, update) {
    try {
      if (/^image\//.test(file.type)) {
        const txt = await window.QR.decodeBlob(file);
        if (!txt) { toast('Na obrazie nie znaleziono kodu QR.', 'error'); return; }
        ta.value = txt;
        toast('Odczytano kod QR z obrazu – możesz go zmienić i wygenerować na nowo.', 'success', 4500);
      } else {
        if (file.size > 200 * 1024) { toast('Plik jest za duży na kod QR. Użyj zakładki „Prześlij”.', 'error'); return; }
        ta.value = (await readText(file)).replace(/\r\n/g, '\n').trim();
      }
      update();
    } catch (e) { toast(e.message, 'error'); }
  }

  function formFor(type) {
    const f = S.gen.fields[type] || (S.gen.fields[type] = type === 'wifi' ? { security: 'WPA' } : {});
    const changed = () => { if (genPreview) genPreview(); };
    const ctrl = ([key, label, kind, extra]) => {
      if (kind === 'toggle') return h('div', { class: 'field inline' }, h('span', { class: 'field-label' }, label), toggle(!!f[key], (v) => { f[key] = v; changed(); }));
      if (kind === 'select') return field(label, select(extra.map(([value, l]) => ({ value, label: l })), f[key] || extra[0][0], (v) => { f[key] = v; changed(); }, { class: 'input full' }));
      if (kind === 'textarea') return field(label, h('textarea', { class: 'input full area', rows: 3, value: f[key] || '', oninput: (e) => { f[key] = e.target.value; changed(); } }));
      return field(label, h('input', {
        class: 'input full', type: kind === 'password' ? 'text' : kind, value: f[key] || '', placeholder: typeof extra === 'string' ? extra : null,
        autocomplete: 'off', spellcheck: 'false', inputmode: kind === 'tel' ? 'tel' : null,
        oninput: (e) => { f[key] = e.target.value; changed(); }
      }));
    };
    const list = C.FIELDS[type];
    const grid = h('div', { class: 'form-grid' }, list.map((x) => {
      const el = ctrl(x);
      if (['note', 'body', 'description', 'street'].includes(x[0]) || x[2] === 'textarea') el.classList.add('wide');
      return el;
    }));
    const extras = [];
    if (type === 'vcard') {
      extras.push(h('div', { class: 'form-tools' },
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          const [file] = await window.QR.pickFiles('.vcf,text/vcard,text/x-vcard');
          if (!file) return;
          try { S.gen.fields.vcard = C.vcardToFields(await readText(file)); renderGenerator(document.getElementById('view')); toast('Wczytano wizytówkę.', 'success'); } catch (e) { toast(e.message, 'error'); }
        } }, iconEl('import', 15), 'Wczytaj plik .vcf'),
        h('button', { class: 'btn plain', type: 'button', onclick: () => { S.gen.fields.vcard = {}; renderGenerator(document.getElementById('view')); } }, 'Wyczyść')));
    }
    if (type === 'geo') {
      extras.push(h('p', { class: 'field-hint' }, 'Współrzędne skopiujesz z Map Google (kliknij miejsce prawym przyciskiem / przytrzymaj palcem).'));
      if (navigator.geolocation) extras.push(h('button', { class: 'btn', type: 'button', onclick: (e) => {
        const b = e.currentTarget;
        busy(b, () => new Promise((res) => navigator.geolocation.getCurrentPosition((pos) => {
          f.lat = pos.coords.latitude.toFixed(6); f.lng = pos.coords.longitude.toFixed(6);
          renderGenerator(document.getElementById('view')); res();
        }, () => { toast('Nie udało się ustalić położenia.', 'error'); res(); }, { timeout: 10000 })), 'Ustalam…');
      } }, iconEl('mapPin', 15), 'Moje położenie'));
    }
    if (type === 'wifi') extras.push(h('p', { class: 'field-hint' }, 'Po zeskanowaniu telefon zaproponuje połączenie z siecią bez przepisywania hasła.'));
    return h('div', null, grid, extras);
  }

  // Ustawienia wyglądu kodu
  function lookPanel() {
    const L = look();
    const ch = async (patch) => { await saveLook(patch); if (genPreview) genPreview(); };
    const color = (key) => {
      const inp = h('input', { type: 'color', class: 'color', value: L[key], oninput: (e) => { L[key] = e.target.value; if (genPreview) genPreview(); }, onchange: (e) => ch({ [key]: e.target.value }) });
      return inp;
    };
    const range = (key, min, max, step, fmt) => {
      const out = h('span', { class: 'range-val' }, fmt(L[key]));
      const r = h('input', { type: 'range', class: 'range', min, max, step, value: L[key], oninput: (e) => { L[key] = Number(e.target.value); out.textContent = fmt(L[key]); if (genPreview) genPreview(); }, onchange: (e) => ch({ [key]: Number(e.target.value) }) });
      return h('div', { class: 'range-wrap' }, r, out);
    };
    const logoCtl = h('div', { class: 'row-control' });
    const paintLogo = () => {
      logoCtl.replaceChildren(...[
        S.gen.logo ? h('img', { class: 'logo-thumb', src: S.gen.logo, alt: '' }) : null,
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          const [file] = await window.QR.pickFiles('image/*');
          if (!file) return;
          if (file.size > 3 * 1024 * 1024) { toast('Logo może mieć najwyżej 3 MB.', 'error'); return; }
          S.gen.logo = await shrinkImage(await readDataUrl(file), 360);
          paintLogo(); if (genPreview) genPreview();
        } }, S.gen.logo ? 'Zmień' : 'Wybierz…'),
        S.gen.logo ? h('button', { class: 'btn plain danger', type: 'button', onclick: () => { S.gen.logo = null; paintLogo(); if (genPreview) genPreview(); } }, 'Usuń') : null].filter(Boolean));
    };
    paintLogo();
    const caption = h('input', { class: 'input', placeholder: 'np. Zeskanuj mnie', value: L.caption, maxlength: 60, oninput: (e) => { L.caption = e.target.value; if (genPreview) genPreview(); }, onchange: (e) => ch({ caption: e.target.value }) });

    const rows = [
      row('Korekcja błędów', segmented([{ value: 'L', label: 'L' }, { value: 'M', label: 'M' }, { value: 'Q', label: 'Q' }, { value: 'H', label: 'H' }], L.ecc, (v) => ch({ ecc: v })), { icon: 'shield', color: '#34c759', hint: 'Wyższa = odporniejszy na zabrudzenia, ale gęstszy. Z logo zawsze H.' }),
      row('Moduły', segmented([{ value: 'square', label: 'Kwadraty' }, { value: 'rounded', label: 'Obłe' }, { value: 'dots', label: 'Kropki' }], L.style, (v) => ch({ style: v })), { icon: 'qr', color: '#007aff' }),
      row('Narożniki', segmented([{ value: 'square', label: 'Proste' }, { value: 'rounded', label: 'Obłe' }, { value: 'circle', label: 'Koła' }], L.eyes, (v) => ch({ eyes: v })), { icon: 'expand', color: '#5856d6' }),
      row('Kolory', h('div', { class: 'colors' }, h('label', null, color('fg'), 'kod'), h('label', null, color('bg'), 'tło'), h('button', { class: 'btn plain', type: 'button', title: 'Czarny na białym', onclick: () => { ch({ fg: '#000000', bg: '#ffffff' }); setTimeout(() => renderGenerator(document.getElementById('view')), 0); } }, 'Domyślne')), { icon: 'palette', color: '#ff9500' }),
      row('Margines', range('margin', 0, 10, 1, (v) => v + ' mod.'), { icon: 'sliders', color: '#8e8e93', hint: 'Biała ramka wokół kodu – zalecane co najmniej 4' }),
      row('Logo w środku', logoCtl, { icon: 'image', color: '#ff2d55' }),
      row('Rozmiar logo', range('logoScale', 0.12, 0.26, 0.01, (v) => Math.round(v * 100) + '%'), { icon: 'image', color: '#ff2d55' }),
      row('Podpis pod kodem', caption, { icon: 'text', color: '#30b0c7' }),
      row('Rozmiar PNG', select([512, 1024, 2048, 4096].map((v) => ({ value: String(v), label: v + ' px' })), String(L.exportSize), (v) => ch({ exportSize: Number(v) })), { icon: 'photo', color: '#a2845e' })
    ];
    const det = h('details', { class: 'advanced look' }, h('summary', null, iconEl('palette', 16), 'Wygląd kodu'), h('div', { class: 'group-body flat' }, rows));
    if (S.prefs.lookOpen) det.open = true;
    det.addEventListener('toggle', () => savePrefs({ lookOpen: det.open }));
    return det;
  }

  async function shrinkImage(dataUrl, max) {
    const img = await window.QR.loadImage(dataUrl);
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  function currentSvg() {
    const text = genText();
    if (!text) return null;
    const L = look();
    try {
      return { text, ...window.QR.svg(text, { ...L, logo: S.gen.logo, caption: L.caption.trim() }) };
    } catch (_) { return { text, error: true }; }
  }

  function paintPreview(box) {
    const r = currentSvg();
    const L = look();
    if (!r) {
      box.replaceChildren(h('div', { class: 'qr-empty' }, h('div', { class: 'qr-ghost', html: window.icon('qr', 64) }), h('p', { class: 'muted' }, S.gen.type === 'text' ? 'Wklej lub wpisz coś powyżej – kod pojawi się tutaj.' : 'Uzupełnij pola – kod pojawi się tutaj.')));
      return;
    }
    if (r.error) {
      const bytes = C.byteLength(r.text);
      const max = C.MAX_BYTES[S.gen.logo ? 'H' : L.ecc];
      box.replaceChildren(h('div', { class: 'qr-empty bad' },
        iconEl('warn', 28),
        h('h3', null, 'Za dużo danych na jeden kod'),
        h('p', { class: 'muted' }, `${bytes.toLocaleString('pl-PL')} B, a przy korekcji ${S.gen.logo ? 'H (logo)' : L.ecc} mieści się najwyżej ${max.toLocaleString('pl-PL')} B. Zmniejsz korekcję błędów, skróć treść albo wyślij ją ruchomym kodem.`),
        h('button', { class: 'btn primary lg', onclick: () => { S.send.mode = 'text'; S.send.text = r.text; go('send'); } }, iconEl('send', 16), 'Wyślij transmisją')));
      return;
    }
    const ratio = contrast(L.fg, L.bg);
    const warn = [];
    if (ratio < 3) warn.push('Za mały kontrast kolorów – wiele aparatów nie odczyta kodu.');
    else if (lum(L.fg) > lum(L.bg)) warn.push('Jasny kod na ciemnym tle – część starszych czytników tego nie odczyta.');
    if (L.margin < 2) warn.push('Bardzo mały margines – zostaw wokół kodu wolne miejsce.');
    if (L.style === 'dots') warn.push('Kropki wyglądają efektownie, ale starsze czytniki bywają z nimi kapryśne – przed drukiem sprawdź kod kilkoma telefonami.');
    if (r.modules > 81) warn.push('Bardzo gęsty kod – drukuj duży (co najmniej 4–5 cm) albo skróć treść.');

    const art = h('div', { class: 'qr-art', html: r.svg, title: 'Pokaż na pełnym ekranie', onclick: () => fullscreenQr(r) });
    const act = (icon, label, fn, kind) => h('button', { class: 'btn ' + (kind || ''), type: 'button', onclick: (e) => fn(e.currentTarget) }, iconEl(icon, 15), label);
    const actions = [
      act(P.isMobile && !P.isElectron ? 'share' : 'import', 'Zapisz PNG', (b) => busy(b, () => exportPng(r), 'Zapisuję…'), 'primary'),
      act('import', 'SVG', (b) => busy(b, () => exportSvg(r), 'Zapisuję…')),
      P.canCopyImage ? act('copy', 'Kopiuj obraz', (b) => busy(b, () => copyPng(r), 'Kopiuję…')) : null,
      act('text', 'Kopiuj treść', async () => { try { await P.copyText(r.text); toast('Skopiowano treść kodu.', 'success'); } catch (_) { toast('Nie udało się skopiować.', 'error'); } }),
      act('expand', 'Pełny ekran', () => fullscreenQr(r))
    ];
    box.replaceChildren(card(
      art,
      h('p', { class: 'qr-meta muted' }, `Wersja ${r.version} · ${r.modules}×${r.modules} · korekcja ${r.ecc} · ${C.byteLength(r.text).toLocaleString('pl-PL')} B`),
      warn.length ? h('div', { class: 'note warn' }, iconEl('warn', 16), h('span', null, warn.join(' '))) : null,
      h('div', { class: 'qr-actions' }, actions)));
  }

  const baseName = () => {
    const d = C.detect(genText());
    const t = (d.title || 'kod').replace(/^https?:\/\//, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'kod';
    return 'QR-' + t;
  };

  async function exportPng(r) {
    const blob = await window.QR.png(r.svg, look().exportSize);
    const out = await P.saveFile(baseName() + '.png', blob, 'image/png');
    remember();
    if (out && out !== 'shared') toast('Zapisano obraz kodu.', 'success');
  }
  async function exportSvg(r) {
    const out = await P.saveFile(baseName() + '.svg', r.svg, 'image/svg+xml');
    remember();
    if (out && out !== 'shared') toast('Zapisano plik SVG.', 'success');
  }
  async function copyPng(r) {
    try {
      await P.copyImage(await window.QR.png(r.svg, Math.min(1024, look().exportSize)));
      remember();
      toast('Skopiowano obraz kodu – wklej go w dokumencie lub wiadomości.', 'success');
    } catch (_) { toast('Nie udało się skopiować obrazu.', 'error'); }
  }

  // Kod na cały ekran (do pokazania komuś do zeskanowania) – ekran nie gaśnie
  function fullscreenQr(r, opts = {}) {
    if (!opts.noHistory) remember();
    let closed = false;
    const close = (fromBack) => {
      if (closed) return;
      closed = true;
      dropLayer(close, fromBack === true);
      P.keepAwake(false);
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
    };
    const overlay = h('div', { class: 'qr-full', onclick: () => close() },
      h('div', { class: 'qr-full-art', html: r.svg }),
      h('p', null, 'Dotknij, aby zamknąć'));
    document.body.appendChild(overlay);
    pushLayer(close);
    P.keepAwake(true, true);
    requestAnimationFrame(() => overlay.classList.add('show'));
  }

  // ───── historia ─────
  async function remember() {
    if (!S.prefs.history) return;
    const text = genText();
    if (!text) return;
    const d = C.detect(text);
    const entry = { id: Date.now().toString(36), at: Date.now(), type: S.gen.type, fields: JSON.parse(JSON.stringify(S.gen.fields[S.gen.type] || {})), title: d.title || text.slice(0, 60), kind: d.type };
    S.history = [entry, ...S.history.filter((x) => C.build(x.type, x.fields) !== text)].slice(0, 40);
    await P.saveHistory(S.history);
    const box = document.querySelector('.gen-history');
    if (box) paintHistory(box);
  }

  function paintHistory(box) {
    if (!S.prefs.history || !S.history.length) { box.replaceChildren(); return; }
    const typeIcon = (t) => (C.TYPES.find((x) => x.id === t) || { icon: 'qr' }).icon;
    box.replaceChildren(group('Ostatnie', S.history.slice(0, 12).map((x) => {
      const r = row(x.title, h('button', { class: 'icon-btn', title: 'Usuń z historii', html: window.icon('x', 15), onclick: async (e) => {
        e.stopPropagation();
        S.history = S.history.filter((y) => y.id !== x.id);
        await P.saveHistory(S.history);
        paintHistory(box);
      } }), { icon: typeIcon(x.type), color: '#8e8e93', hint: new Date(x.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }), onClick: () => {
        S.gen.type = x.type;
        S.gen.fields[x.type] = JSON.parse(JSON.stringify(x.fields));
        renderGenerator(document.getElementById('view'));
      } });
      return r;
    })));
  }

  // ═════════════════════════ PRZEŚLIJ (nadajnik) ═════════════════════════
  function speedConf() {
    const base = T.PRESETS[S.prefs.speed] || T.PRESETS.normal;
    if (S.prefs.speed === 'custom' && S.prefs.custom) return { ...T.PRESETS.normal, ...S.prefs.custom, label: 'Własna' };
    return base;
  }

  function sendSize() {
    if (S.send.mode === 'text') return C.byteLength(S.send.text);
    return S.send.files.reduce((a, f) => a + f.size, 0);
  }

  function renderSend(view) {
    const what = h('div', { class: 'send-what' });
    const est = h('p', { class: 'estimate' });
    const startBtn = h('button', { class: 'btn primary xl full', type: 'button', onclick: (e) => startTransmit(e.currentTarget) }, iconEl('send', 18), 'Rozpocznij transmisję');

    const refresh = () => {
      const n = sendSize();
      const c = speedConf();
      const sp = T.estimateSpeed(c.version, c.ecc, c.fps);
      startBtn.disabled = !n;
      if (!n) { est.replaceChildren(h('span', { class: 'muted' }, 'Wybierz pliki albo wpisz tekst.')); return; }
      const parts = [h('b', null, fmtB(n)), ` · ok. ${T.formatDuration(n / sp + 3)} przy ~${fmtB(Math.round(sp))}/s`];
      if (S.send.mode === 'text' || S.send.files.some((f) => /^text\/|json|xml|svg|csv/.test(f.type))) parts.push(h('span', { class: 'muted' }, ' (tekst zwykle się kompresuje – będzie szybciej)'));
      est.replaceChildren(...parts);
      if (n > T.MAX_TOTAL) est.append(h('div', { class: 'note warn' }, iconEl('warn', 16), h('span', null, 'Limit jednej transmisji to 16 MB.')));
      else if (n > 3 * 1024 * 1024) est.append(h('div', { class: 'note warn' }, iconEl('clock', 16), h('span', null, 'Duże pliki przesyłają się długo – rozważ zmniejszenie zdjęć lub wysłanie w częściach.')));
    };

    const paintWhat = () => {
      if (S.send.mode === 'text') {
        const ta = h('textarea', { class: 'paste', rows: 7, placeholder: 'Wpisz lub wklej tekst do przesłania – notatkę, listę, hasło Wi-Fi, fragment dokumentu…', value: S.send.text, oninput: (e) => { S.send.text = e.target.value; refresh(); } });
        what.replaceChildren(ta, h('div', { class: 'paste-tools' },
          h('button', { class: 'btn', type: 'button', onclick: async () => { try { const t = await P.readText(); if (t) { ta.value = S.send.text = t; refresh(); } } catch (_) { toast('Brak dostępu do schowka.', 'error'); } } }, iconEl('paste', 15), 'Wklej'),
          h('button', { class: 'btn plain', type: 'button', onclick: () => { ta.value = S.send.text = ''; refresh(); } }, 'Wyczyść')));
      } else {
        const list = h('div', { class: 'file-list' }, S.send.files.map((f, i) => h('div', { class: 'file-row' },
          h('span', { class: 'rx-file-ic', html: window.icon(/^image\//.test(f.type) ? 'image' : 'file', 18) }),
          h('div', { class: 'file-main' }, h('b', null, f.name), h('span', { class: 'muted' }, fmtB(f.size))),
          h('button', { class: 'icon-btn', title: 'Usuń', html: window.icon('x', 15), onclick: () => { S.send.files.splice(i, 1); paintWhat(); refresh(); } }))));
        const drop = h('button', { class: 'dropzone' + (S.send.files.length ? ' small' : ''), type: 'button', onclick: async () => { addFiles(await window.QR.pickFiles('', true)); } },
          iconEl('import', S.send.files.length ? 18 : 30),
          h('b', null, S.send.files.length ? 'Dodaj pliki' : 'Wybierz pliki'),
          S.send.files.length ? null : h('span', { class: 'muted' }, P.isMobile ? 'Zdjęcia, dokumenty, kontakty – dowolne pliki' : 'albo przeciągnij je tutaj'));
        what.replaceChildren(...[S.send.files.length ? list : null, drop].filter(Boolean));
      }
    };
    const addFiles = (files) => {
      for (const f of files) if (!S.send.files.some((x) => x.name === f.name && x.size === f.size)) S.send.files.push(f);
      paintWhat();
      refresh();
    };
    S.send.addFiles = addFiles;

    const modeSeg = segmented([{ value: 'files', label: 'Pliki', icon: 'file' }, { value: 'text', label: 'Tekst', icon: 'text' }], S.send.mode, (v) => { S.send.mode = v; paintWhat(); refresh(); });

    // prędkość
    const c0 = speedConf();
    const speedHint = h('p', { class: 'field-hint' });
    const custom = S.prefs.custom || { version: c0.version, ecc: c0.ecc, fps: c0.fps };
    const fpsOut = h('span', { class: 'range-val' }), verOut = h('span', { class: 'range-val' });
    const setCustom = async (patch) => { Object.assign(custom, patch); await savePrefs({ speed: 'custom', custom: { ...custom } }); paintSpeed(); refresh(); };
    const fpsR = h('input', { type: 'range', class: 'range', min: 2, max: 24, step: 1, value: custom.fps, oninput: (e) => setCustom({ fps: Number(e.target.value) }) });
    const verR = h('input', { type: 'range', class: 'range', min: 6, max: 32, step: 1, value: custom.version, oninput: (e) => setCustom({ version: Number(e.target.value) }) });
    const eccSeg = segmented([{ value: 'L', label: 'L – szybciej' }, { value: 'M', label: 'M – pewniej' }], custom.ecc, (v) => setCustom({ ecc: v }));
    let speedSeg;
    const paintSpeed = () => {
      const c = speedConf();
      speedHint.textContent = (S.prefs.speed === 'custom' ? 'Własne ustawienia' : c.hint) + ` · ${c.fps} kl./s, kod ${17 + c.version * 4}×${17 + c.version * 4}, ~${fmtB(Math.round(T.estimateSpeed(c.version, c.ecc, c.fps)))}/s`;
      fpsOut.textContent = custom.fps + ' kl./s';
      verOut.textContent = 'wersja ' + custom.version;
      speedSeg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', ['safe', 'normal', 'fast'][i] === S.prefs.speed));
    };
    speedSeg = segmented(['safe', 'normal', 'fast'].map((k) => ({ value: k, label: T.PRESETS[k].label })), S.prefs.speed, async (v) => {
      await savePrefs({ speed: v });
      const p = T.PRESETS[v];
      Object.assign(custom, { version: p.version, ecc: p.ecc, fps: p.fps });
      fpsR.value = p.fps; verR.value = p.version;
      paintSpeed(); refresh();
    });
    const adv = h('details', { class: 'advanced' }, h('summary', null, 'Ustawienia zaawansowane'),
      h('div', { class: 'fields' },
        field('Klatki na sekundę', h('div', { class: 'range-wrap' }, fpsR, fpsOut), 'Więcej = szybciej, ale aparat odbiorcy musi nadążyć.'),
        field('Wielkość kodu', h('div', { class: 'range-wrap' }, verR, verOut), 'Większy kod mieści więcej danych w klatce, ale wymaga lepszego aparatu.'),
        field('Korekcja błędów', eccSeg)));

    view.replaceChildren(h('div', { class: 'page narrow' },
      pageHead('Prześlij', 'Pliki i tekst na drugi telefon lub komputer – ruchomym kodem QR. Bez internetu, Bluetootha i parowania, a odbiorca nie musi niczego instalować.'),
      card(h('div', { class: 'card-head' }, h('h3', null, 'Co wysłać'), modeSeg), what),
      card(h('div', { class: 'card-head' }, h('h3', null, 'Prędkość'), speedSeg), speedHint, adv),
      h('div', { class: 'send-go' }, est, startBtn),
      howItWorks()));
    paintWhat();
    paintSpeed();
    refresh();
  }

  function howItWorks() {
    const d = h('details', { class: 'advanced how' }, h('summary', null, iconEl('info', 16), 'Jak to działa i czy to bezpieczne?'),
      h('ol', { class: 'qr-steps' },
        h('li', null, 'Najpierw pokażę ', h('b', null, 'kod startowy'), ' – zwykły link. Drugie urządzenie skanuje go wbudowanym aparatem (iPhone, Android) i otwiera w przeglądarce stronę odbioru. Nic się nie instaluje.'),
        h('li', null, 'Na stronie odbioru trzeba nacisnąć ', h('b', null, 'Odbieraj'), ' i zezwolić na aparat – nic nie dzieje się samo.'),
        h('li', null, 'Po naciśnięciu ', h('b', null, 'Start'), ' dane płyną obrazem: ekran → aparat. Odbiorca przyjmuje tylko tę jedną transmisję (identyfikator z kodu startowego) i na końcu sprawdza sumę kontrolną SHA-256.'),
        h('li', null, 'Gdy komplet dotrze, odbiór kończy się sam i aparat się wyłącza. Pliki nie otwierają się automatycznie.')),
      h('p', { class: 'field-hint' }, 'Parametry transmisji są w części linku po „#”, której przeglądarka nie wysyła do serwera, a sama strona nie przesyła żadnych danych. Kto widzi Twój ekran w czasie transmisji, mógłby jednak nagrać kody – wysyłaj poufne dane tylko tam, gdzie nikt nie patrzy.'));
    return d;
  }

  async function collectSendItem() {
    if (S.send.mode === 'text') {
      if (!S.send.text) throw new Error('Wpisz tekst do wysłania.');
      return { item: { kind: 'text', text: S.send.text }, name: 'Tekst', count: 1 };
    }
    if (!S.send.files.length) throw new Error('Wybierz pliki do wysłania.');
    const files = [];
    for (const f of S.send.files) files.push({ name: f.name, type: f.type || 'application/octet-stream', data: new Uint8Array(await f.arrayBuffer()) });
    return { item: { kind: 'files', files }, name: files.length === 1 ? files[0].name : `${files.length} pliki`, count: files.length };
  }

  async function startTransmit(btn) {
    let prepared;
    try {
      prepared = await busy(btn, async () => {
        const { item, name, count } = await collectSendItem();
        const built = await T.buildPayload(item);
        return { built, name, count };
      }, 'Przygotowuję…');
    } catch (e) { toast(e.message, 'error'); return; }
    transmit(prepared);
  }

  // ───── ekran nadawania ─────
  function transmit({ built, name, count }) {
    const conf = { ...speedConf() };
    const sender = new T.Sender(built, { version: conf.version, ecc: conf.ecc });
    const link = T.buildLink(S.prefs.receiverUrl || T.DEFAULT_RECEIVER, { session: sender.session, hashHex: built.hashHex, name, bytes: built.containerSize, count });
    let phase = 'start', paused = false, raf = 0, lastAt = 0, closed = false, fps = conf.fps, startedAt = 0;

    const canvas = h('canvas', { class: 'tx-canvas' });
    const info = h('p', { class: 'tx-info' });
    const bar = h('div', { class: 'tx-bar' }, h('span'));
    const hint = h('p', { class: 'tx-hint' });
    const fpsLabel = h('span', { class: 'tx-fps' });
    const pauseBtn = h('button', { class: 'btn lg', type: 'button', onclick: () => togglePause() });
    const body = h('div', { class: 'tx-body' });

    const close = (fromBack) => {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(raf);
      dropLayer(close, fromBack === true);
      P.keepAwake(false);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fit);
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
    };
    const setFps = (v) => { fps = Math.max(1, Math.min(30, v)); fpsLabel.textContent = fps + ' kl./s'; };
    const overlay = h('div', { class: 'tx' },
      h('div', { class: 'tx-top' },
        h('button', { class: 'icon-btn round lg', title: 'Zakończ', html: window.icon('x', 18), onclick: () => close() }),
        h('div', { class: 'tx-title' }, h('b', null, name), h('span', null, `${fmtB(built.containerSize)}${built.flags & 1 ? ` → ${fmtB(built.payload.length)} po kompresji` : ''} · ${sender.K} ${sender.K === 1 ? 'klatka' : 'klatek'} na okrążenie`)),
        h('span', { class: 'spacer' })),
      body);

    function renderStart() {
      phase = 'start';
      cancelAnimationFrame(raf);
      const art = h('div', { class: 'tx-link-art', html: window.QR.svg(link, { ecc: 'M', margin: 3 }).svg });
      body.replaceChildren(h('div', { class: 'tx-start' },
        art,
        h('div', { class: 'tx-start-text' },
          h('h2', null, 'Zeskanuj kod drugim urządzeniem'),
          h('ol', { class: 'qr-steps' },
            h('li', null, 'Otwórz zwykły ', h('b', null, 'aparat'), ' (iPhone, Android) i skieruj go na ten kod – stuknij pokazany link.'),
            h('li', null, 'Na otwartej stronie naciśnij ', h('b', null, 'Odbieraj'), ' i zezwól na aparat.'),
            h('li', null, 'Skieruj aparat odbiorcy na ten ekran i naciśnij tu ', h('b', null, 'Start'), '.')),
          h('div', { class: 'tx-start-btns' },
            h('button', { class: 'btn primary xl', type: 'button', onclick: renderSending }, iconEl('play', 18), 'Start'),
            h('button', { class: 'btn lg', type: 'button', onclick: async () => { try { await P.copyText(link); toast('Skopiowano link strony odbioru.', 'success'); } catch (_) { toast('Nie udało się skopiować.', 'error'); } } }, iconEl('link', 15), 'Kopiuj link')),
          h('p', { class: 'field-hint' }, 'Odbiorca ma aplikację QR? Niech otworzy zakładkę „Odbierz” i zeskanuje ten kod albo od razu ruchomy kod.'))));
    }

    function renderSending() {
      phase = 'send';
      startedAt = startedAt || Date.now();
      paused = false;
      body.replaceChildren(h('div', { class: 'tx-send' },
        h('div', { class: 'tx-stage' }, canvas),
        h('div', { class: 'tx-controls' },
          bar, info, hint,
          h('div', { class: 'tx-btns' },
            pauseBtn,
            h('div', { class: 'tx-fps-ctl' },
              h('button', { class: 'icon-btn round', title: 'Wolniej', html: window.icon('minus', 16), onclick: () => setFps(fps - 1) }),
              fpsLabel,
              h('button', { class: 'icon-btn round', title: 'Szybciej', html: window.icon('plus', 16), onclick: () => setFps(fps + 1) })),
            h('button', { class: 'btn lg', type: 'button', onclick: renderStart }, iconEl('qr', 15), 'Kod startowy'),
            h('button', { class: 'btn lg danger', type: 'button', onclick: () => close() }, iconEl('stop', 15), 'Zakończ')))));
      setFps(fps);
      paintPause();
      requestAnimationFrame(() => { fit(); loop(); });
    }

    function fit() {
      if (phase !== 'send') return;
      const stage = canvas.parentElement;
      const size = Math.max(120, Math.floor(Math.min(stage.clientWidth, stage.clientHeight)));
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = canvas.style.height = size + 'px';
      canvas.width = canvas.height = Math.floor(size * dpr);
      lastAt = 0;
    }

    function paintPause() {
      pauseBtn.replaceChildren(iconEl(paused ? 'play' : 'pause', 15), document.createTextNode(paused ? 'Wznów' : 'Pauza'));
    }
    function togglePause() { if (phase !== 'send') return; paused = !paused; paintPause(); if (!paused) loop(); }

    function loop(now) {
      if (closed || phase !== 'send' || paused) return;
      raf = requestAnimationFrame(loop);
      now = now || performance.now();
      if (lastAt && now - lastAt < 1000 / fps - 4) return;
      lastAt = now;
      window.QR.drawToCanvas(canvas, sender.nextFrame(), sender.version, sender.ecc, 3);
      const rounds = sender.rounds;
      bar.firstChild.style.width = Math.min(100, rounds * 100) + '%';
      bar.classList.toggle('extra', rounds >= 1);
      const secs = (Date.now() - startedAt) / 1000;
      info.textContent = `Klatka ${sender.sent.toLocaleString('pl-PL')} · ${rounds < 1 ? Math.floor(rounds * 100) + '% pierwszego okrążenia' : 'okrążenie ' + rounds.toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + '×'} · ${T.formatDuration(secs)}`;
      hint.textContent = rounds < 1
        ? 'Trzymaj ekran nieruchomo, jasno i bez odblasków. Odbiorca widzi postęp u siebie.'
        : 'Nadaję dodatkowe klatki naprawcze – odbiorca zbiera brakujące. Gdy pokaże ✓ „Odebrano”, naciśnij Zakończ.';
    }

    function onKey(e) {
      if (closed) return;
      if (e.key === ' ' && phase === 'send') { e.preventDefault(); togglePause(); }
      else if ((e.key === '+' || e.key === '=') && phase === 'send') setFps(fps + 1);
      else if (e.key === '-' && phase === 'send') setFps(fps - 1);
      else if (e.key === 'Enter' && phase === 'start') renderSending();
    }

    document.body.appendChild(overlay);
    pushLayer(close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', fit);
    P.keepAwake(true, true);
    renderStart();
    requestAnimationFrame(() => overlay.classList.add('show'));
  }

  // ═════════════════════════ ODBIERZ ═════════════════════════
  function renderReceive(view) {
    const go2 = (fn) => () => fn();
    const rows = [
      row('Skanuj aparatem', iconEl('chevronR', 16, 'chev'), { icon: 'camera', color: '#007aff', hint: 'Zwykłe kody QR oraz transmisje z innego urządzenia', onClick: go2(() => openReceiver({})) }),
      P.canScanScreen ? row('Znajdź kod na ekranie', iconEl('chevronR', 16, 'chev'), { icon: 'display', color: '#5856d6', hint: 'Np. kod wyświetlony w przeglądarce lub dokumencie', onClick: go2(scanScreen) }) : null,
      row('Odczytaj z obrazu', iconEl('chevronR', 16, 'chev'), { icon: 'photo', color: '#34c759', hint: 'Zdjęcie lub zrzut ekranu z kodem', onClick: go2(scanImageFile) }),
      !P.isMobile ? row('Wklej ze schowka', iconEl('chevronR', 16, 'chev'), { icon: 'paste', color: '#ff9500', hint: 'Obraz kodu QR (Ctrl+V)', onClick: go2(pasteImage) }) : null
    ];
    const recvLink = (S.prefs.receiverUrl || T.DEFAULT_RECEIVER);
    view.replaceChildren(h('div', { class: 'page narrow' },
      pageHead('Odbierz', 'Odczytuj kody QR i odbieraj dane wysyłane z ekranu innego urządzenia.'),
      h('button', { class: 'hero-btn', type: 'button', onclick: () => openReceiver({}) },
        h('span', { class: 'hero-ic', html: window.icon('camera', 30) }),
        h('div', null, h('b', null, 'Skanuj aparatem'), h('span', null, P.isMobile ? 'Skieruj aparat na kod lub ekran nadawcy' : 'Kamera internetowa – pokaż kod lub ekran telefonu nadawcy'))),
      group('Inne sposoby', rows.slice(1).filter(Boolean)),
      group('Odbiór bez aplikacji', [
        row('Strona odbioru', iconEl('chevronR', 16, 'chev'), { icon: 'globe', color: '#30b0c7', hint: recvLink.replace(/^https?:\/\//, '') + ' – działa w przeglądarce każdego telefonu i komputera', onClick: () => P.openExternal(recvLink) })
      ], 'Aplikacja nie musi być zainstalowana u odbiorcy: kod startowy z zakładki „Prześlij” otwiera tę stronę i uruchamia nasłuch dopiero po zgodzie odbiorcy.')));
  }

  function openReceiver({ link }) {
    if (S.rx) { S.rx.stop(); S.rx = null; }
    let closed = false;
    const close = (fromBack) => {
      if (closed) return;
      closed = true;
      dropLayer(close, fromBack === true);
      if (S.rx) { S.rx.stop(); S.rx = null; }
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      if (link && location.hash) history.replaceState(null, '', location.pathname + location.search);
    };
    const inner = h('div', { class: 'rx-host' });
    const overlay = h('div', { class: 'rx-overlay' }, inner);
    document.body.appendChild(overlay);
    pushLayer(close);
    requestAnimationFrame(() => overlay.classList.add('show'));
    S.rx = window.RX.mount(inner, {
      link, embedded: true, autoStart: !link,
      onClose: () => close(),
      onSingle: (text) => { close(); setTimeout(() => showScanned(text), 120); }
    });
  }

  async function scanImageFile() {
    const [file] = await window.QR.pickFiles('image/*');
    if (!file) return;
    const text = await window.QR.decodeBlob(file).catch(() => null);
    if (text) showScanned(text); else toast('Na obrazie nie znaleziono kodu QR.', 'error');
  }

  async function scanScreen() {
    try {
      const shots = await P.captureScreens();
      for (const src of shots) {
        const text = await window.QR.decodeImageSource(src);
        if (text) { showScanned(text); return; }
      }
      toast('Nie znaleziono kodu QR na ekranie. Upewnij się, że jest w całości widoczny.', 'error', 5000);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function pasteImage() {
    try {
      const img = await P.readImage();
      if (img) { const text = await window.QR.decodeBlob(img); if (text) { showScanned(text); return; } toast('Na obrazie ze schowka nie ma kodu QR.', 'error'); return; }
      const t = await P.readText();
      if (t) { showScanned(t); return; }
      toast('Schowek nie zawiera obrazu.', 'error');
    } catch (_) { toast('Brak dostępu do schowka – użyj Ctrl+V.', 'error'); }
  }

  // Wynik odczytu zwykłego kodu QR
  function showScanned(text) {
    const tlink = T.parseLink(text);
    if (tlink) { openReceiver({ link: tlink }); return; }
    const d = C.detect(text);
    let s;
    const act = (icon, label, fn, kind) => h('button', { class: 'btn lg ' + (kind || ''), type: 'button', onclick: async (e) => { try { await fn(e.currentTarget); } catch (err) { toast(err.message || String(err), 'error'); } } }, iconEl(icon, 16), label);
    const copy = (t, msg) => P.copyText(t).then(() => toast(msg || 'Skopiowano.', 'success'));
    const actions = [];
    if (d.type === 'url') actions.push(act('globe', 'Otwórz stronę', () => P.openExternal(d.url), 'primary'));
    if (d.type === 'email' || d.type === 'tel') actions.push(act(d.type === 'email' ? 'mail' : 'phone', d.type === 'email' ? 'Napisz e-mail' : 'Zadzwoń', () => P.openExternal(d.url), 'primary'));
    if (d.type === 'vcard') actions.push(act('person', 'Zapisz kontakt', () => P.saveFile((d.title || 'kontakt').replace(/\s+/g, '_') + '.vcf', text, 'text/vcard'), 'primary'));
    if (d.type === 'event') actions.push(act('calendar', 'Dodaj do kalendarza', () => P.saveFile('wydarzenie.ics', /BEGIN:VCALENDAR/i.test(text) ? text : `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//QR//PL\n${text.trim()}\nEND:VCALENDAR`, 'text/calendar'), 'primary'));
    if (d.type === 'wifi' && d.wifi.password) actions.push(act('key', 'Kopiuj hasło Wi-Fi', () => copy(d.wifi.password, 'Skopiowano hasło sieci ' + d.wifi.ssid + '.'), 'primary'));
    if (d.type === 'geo') actions.push(act('mapPin', 'Pokaż na mapie', () => P.openExternal(`https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lng}#map=17/${d.lat}/${d.lng}`), 'primary'));
    actions.push(act('copy', 'Kopiuj treść', () => copy(text, 'Skopiowano treść kodu.')));
    if (P.canShare) actions.push(act('share', 'Udostępnij', () => P.shareText(text).catch(() => {})));
    actions.push(act('pencil', 'Edytuj w generatorze', () => {
      s.close();
      if (d.type === 'vcard' && /^BEGIN:VCARD/i.test(text.trim())) { S.gen.type = 'vcard'; S.gen.fields.vcard = C.vcardToFields(text); }
      else if (d.type === 'wifi') { S.gen.type = 'wifi'; S.gen.fields.wifi = d.wifi; }
      else { S.gen.type = 'text'; S.gen.fields.text = { text }; }
      go('gen');
    }));
    const label = { url: 'Link', vcard: 'Wizytówka', wifi: 'Sieć Wi-Fi', email: 'E-mail', sms: 'SMS', tel: 'Telefon', geo: 'Miejsce', event: 'Wydarzenie', otp: 'Klucz 2FA', text: 'Tekst' }[d.type] || 'Kod QR';
    s = sheet({
      title: label, subtitle: d.type === 'url' ? 'Sprawdź adres, zanim go otworzysz.' : null,
      body: h('div', { class: 'scan-result' },
        d.type !== 'text' ? h('div', { class: 'detect big' }, h('div', null, h('b', null, d.title), d.detail && d.detail !== d.title && d.type !== 'wifi' ? h('span', { class: 'muted' }, d.detail) : null)) : null,
        d.type === 'wifi' ? h('div', { class: 'secret-box small' }, `Sieć: ${d.wifi.ssid}\nHasło: ${d.wifi.password || '(brak)'}\nZabezpieczenie: ${d.wifi.security}`) : null,
        h('pre', { class: 'rx-text' }, text),
        h('div', { class: 'rx-actions' }, actions))
    });
  }

  // ═════════════════════════ USTAWIENIA ═════════════════════════
  function renderSettings(view) {
    const look_ = [
      row('Motyw', segmented([{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Jasny' }, { value: 'dark', label: 'Ciemny' }], S.prefs.theme, async (v) => { await savePrefs({ theme: v }); applyTheme(); }), { icon: 'moon', color: '#5856d6' })
    ];
    const tx = [
      row('Domyślna prędkość', select([{ value: 'safe', label: 'Pewna' }, { value: 'normal', label: 'Zwykła' }, { value: 'fast', label: 'Szybka' }, { value: 'custom', label: 'Własna' }], S.prefs.speed, (v) => savePrefs({ speed: v })), { icon: 'bolt', color: '#ff9500' }),
      row('Adres strony odbioru', iconEl('chevronR', 16, 'chev'), { icon: 'globe', color: '#30b0c7', hint: (S.prefs.receiverUrl || T.DEFAULT_RECEIVER).replace(/^https?:\/\//, ''), onClick: editReceiverUrl }),
      row('Kod do strony odbioru', iconEl('chevronR', 16, 'chev'), { icon: 'qr', color: '#007aff', hint: 'Pokaż komuś, by przygotował odbiór z wyprzedzeniem', onClick: () => fullscreenQr(window.QR.svg(S.prefs.receiverUrl || T.DEFAULT_RECEIVER, { ecc: 'M' }), { noHistory: true }) })
    ];
    const hist = [
      row('Zapamiętuj wygenerowane kody', toggle(S.prefs.history, async (v) => { await savePrefs({ history: v }); if (!v) { S.history = []; await P.saveHistory([]); } }), { icon: 'history', color: '#8e8e93', hint: 'Lista „Ostatnie” w generatorze, tylko na tym urządzeniu' }),
      row('Wyczyść historię', null, { icon: 'trash', color: '#ff3b30', danger: true, onClick: async () => {
        if (!(await confirm({ title: 'Wyczyścić historię?', text: 'Usunę listę ostatnio wygenerowanych kodów.', ok: 'Wyczyść', danger: true }))) return;
        S.history = []; await P.saveHistory([]); toast('Wyczyszczono historię.', 'success');
      } }),
      row('Przywróć domyślny wygląd kodu', null, { icon: 'refresh', color: '#8e8e93', onClick: async () => { await savePrefs({ look: { ...DEFAULT_LOOK } }); toast('Przywrócono domyślny wygląd.', 'success'); } })
    ];
    const plat = { win32: 'Windows', linux: 'Linux', darwin: 'macOS', android: 'Android', web: P.isIOS ? 'iPhone / iPad (przeglądarka)' : 'Przeglądarka' }[S.info.platform] || S.info.platform;
    const about = [
      row('Wersja', h('span', { class: 'muted' }, (S.info.version || '1.0.0') + (plat ? ' · ' + plat : '')), { icon: 'info', color: '#8e8e93' }),
      row('Pobierz na inne urządzenia', iconEl('chevronR', 16, 'chev'), { icon: 'import', color: '#34c759', hint: 'Windows, Linux, macOS, Android – oraz wersja w przeglądarce dla iPhone\'a', onClick: () => P.openExternal('https://github.com/z0z6/QR/releases/latest') }),
      row('Wersja w przeglądarce', iconEl('chevronR', 16, 'chev'), { icon: 'globe', color: '#007aff', hint: 'z0z6.github.io/QR – na iPhonie: Udostępnij → Do ekranu początkowego', onClick: () => P.openExternal('https://z0z6.github.io/QR/') })
    ];
    if (P.isElectron && S.info.dataDir) about.push(row('Folder ustawień', null, { icon: 'folder', color: '#ff9500', hint: S.info.dataDir }));
    view.replaceChildren(h('div', { class: 'page narrow' },
      pageHead('Ustawienia'),
      group('Wygląd', look_),
      group('Transmisja', tx),
      group('Generator', hist),
      group('Informacje', about, 'Kody tworzone są na tym urządzeniu. Aplikacja nie wysyła treści kodów ani przesyłanych plików do internetu.')));
  }

  function editReceiverUrl() {
    const input = h('input', { class: 'input lg full', type: 'url', value: S.prefs.receiverUrl || T.DEFAULT_RECEIVER, spellcheck: 'false', autocomplete: 'off' });
    const err = h('p', { class: 'form-error' });
    sheet({
      title: 'Adres strony odbioru',
      subtitle: 'Zmień tylko, jeśli udostępniasz stronę odbior.html na własnym serwerze (musi działać przez HTTPS – inaczej przeglądarka nie da dostępu do aparatu).',
      body: h('div', { class: 'fields' }, input, err),
      actions: [
        { label: 'Domyślny', onClick: async () => { await savePrefs({ receiverUrl: T.DEFAULT_RECEIVER }); go('settings'); } },
        { label: 'Zapisz', kind: 'primary', onClick: async () => {
          const v = input.value.trim();
          if (!/^https:\/\/[^\s#]+$/i.test(v)) { err.textContent = 'Podaj pełny adres zaczynający się od https://'; return false; }
          await savePrefs({ receiverUrl: v });
          go('settings');
        } }
      ]
    });
  }

  // ═════════════════════════ zdarzenia globalne ═════════════════════════
  function setupDrop() {
    let depth = 0;
    const isFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    document.addEventListener('dragenter', (e) => { if (!isFiles(e)) return; depth++; document.body.classList.add('dragging'); });
    document.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
    document.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      depth = 0;
      document.body.classList.remove('dragging');
      if (!isFiles(e)) return;
      e.preventDefault();
      const files = [...e.dataTransfer.files];
      if (!files.length) return;
      if (S.tab === 'recv' && files.length === 1 && /^image\//.test(files[0].type)) {
        window.QR.decodeBlob(files[0]).then((t) => (t ? showScanned(t) : toast('Na obrazie nie znaleziono kodu QR.', 'error')));
        return;
      }
      S.send.mode = 'files';
      if (S.tab !== 'send') go('send');
      S.send.addFiles(files);
    });
    document.addEventListener('paste', async (e) => {
      if (S.tab !== 'recv' || document.querySelector('.sheet-overlay, .rx-overlay, .tx')) return;
      const item = [...(e.clipboardData && e.clipboardData.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) {
        e.preventDefault();
        const t = await window.QR.decodeBlob(item.getAsFile());
        if (t) showScanned(t); else toast('Na obrazie ze schowka nie ma kodu QR.', 'error');
      }
    });
  }

  // Android: „Udostępnij → QR” z przeglądarki lub galerii
  async function checkShared() {
    const sh = await P.takeShared();
    if (!sh) return;
    window.UI.closeAllLayers();
    if (sh.files.length) {
      S.send.mode = 'files';
      S.send.files = sh.files.map((f) => new File([f.data], f.name, { type: f.type }));
      go('send');
      toast('Pliki gotowe do przesłania.', 'success');
    } else if (sh.text) {
      S.gen.type = 'text';
      S.gen.fields.text = { text: sh.text.trim() };
      go('gen');
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkShared(); });

  // tryb deweloperski (zrzuty ekranu)
  window.__app = { S, go, transmit, showScanned, openReceiver, fullscreenQr, renderGenerator, T, C };

  init().catch((e) => {
    console.error(e);
    $view.replaceChildren(h('div', { class: 'auth' }, h('h1', null, 'Błąd uruchomienia'), h('p', { class: 'muted' }, e.message)));
  });
})();
