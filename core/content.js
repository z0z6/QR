'use strict';
// Treść kodów QR: budowanie (wizytówka, Wi-Fi, e-mail, SMS…) i rozpoznawanie wklejonego tekstu.
// Formaty są tymi, które rozumieją wbudowane aparaty iPhone'ów i Androida.

(function (root) {
  const TYPES = [
    { id: 'text', label: 'Tekst / link', icon: 'link' },
    { id: 'vcard', label: 'Wizytówka', icon: 'person' },
    { id: 'wifi', label: 'Wi-Fi', icon: 'wifi' },
    { id: 'email', label: 'E-mail', icon: 'mail' },
    { id: 'sms', label: 'SMS', icon: 'message' },
    { id: 'tel', label: 'Telefon', icon: 'phone' },
    { id: 'geo', label: 'Miejsce', icon: 'mapPin' },
    { id: 'event', label: 'Wydarzenie', icon: 'calendar' }
  ];

  // Pola formularzy: [klucz, etykieta, typ pola, podpowiedź]
  const FIELDS = {
    vcard: [
      ['first', 'Imię', 'text'], ['last', 'Nazwisko', 'text'],
      ['org', 'Firma / instytucja', 'text'], ['title', 'Stanowisko', 'text'],
      ['tel', 'Telefon', 'tel'], ['tel2', 'Telefon służbowy', 'tel'],
      ['email', 'E-mail', 'email'], ['url', 'Strona www', 'url'],
      ['street', 'Ulica i numer', 'text'], ['zip', 'Kod pocztowy', 'text'], ['city', 'Miejscowość', 'text'], ['country', 'Kraj', 'text'],
      ['note', 'Notatka', 'textarea']
    ],
    wifi: [['ssid', 'Nazwa sieci (SSID)', 'text'], ['security', 'Zabezpieczenie', 'select', [['WPA', 'WPA/WPA2/WPA3'], ['WEP', 'WEP'], ['nopass', 'Brak (sieć otwarta)']]], ['password', 'Hasło', 'password'], ['hidden', 'Sieć ukryta', 'toggle']],
    email: [['to', 'Adres odbiorcy', 'email'], ['subject', 'Temat', 'text'], ['body', 'Treść', 'textarea']],
    sms: [['tel', 'Numer telefonu', 'tel'], ['body', 'Treść wiadomości', 'textarea']],
    tel: [['tel', 'Numer telefonu', 'tel']],
    geo: [['lat', 'Szerokość geograficzna', 'text', 'np. 52.2297'], ['lng', 'Długość geograficzna', 'text', 'np. 21.0122'], ['label', 'Nazwa miejsca (opcjonalnie)', 'text']],
    event: [['summary', 'Nazwa wydarzenia', 'text'], ['start', 'Początek', 'datetime-local'], ['end', 'Koniec', 'datetime-local'], ['location', 'Miejsce', 'text'], ['description', 'Opis', 'textarea']]
  };

  const vEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const wEsc = (s) => String(s || '').replace(/([\\;,:"])/g, '\\$1');
  const tel = (s) => String(s || '').replace(/[^\d+*#]/g, '');
  const trim = (s) => String(s == null ? '' : s).trim();

  function icsDate(local) {
    // datetime-local „2026-11-24T18:30” → „20261124T183000” (czas lokalny – kalendarz przyjmie strefę urządzenia)
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || '');
    return m ? `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}00` : '';
  }

  function build(type, f) {
    f = f || {};
    switch (type) {
      case 'text': return String(f.text || '');
      case 'vcard': {
        const first = trim(f.first), last = trim(f.last);
        const fn = [first, last].filter(Boolean).join(' ') || trim(f.org);
        if (!fn && !trim(f.tel) && !trim(f.email)) return '';
        const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEsc(last)};${vEsc(first)};;;`, `FN:${vEsc(fn)}`];
        if (trim(f.org)) lines.push('ORG:' + vEsc(f.org));
        if (trim(f.title)) lines.push('TITLE:' + vEsc(f.title));
        if (trim(f.tel)) lines.push('TEL;TYPE=CELL:' + trim(f.tel));
        if (trim(f.tel2)) lines.push('TEL;TYPE=WORK:' + trim(f.tel2));
        if (trim(f.email)) lines.push('EMAIL:' + trim(f.email));
        if (trim(f.url)) lines.push('URL:' + trim(f.url));
        if (trim(f.street) || trim(f.city) || trim(f.zip) || trim(f.country)) lines.push(`ADR;TYPE=WORK:;;${vEsc(f.street)};${vEsc(f.city)};;${vEsc(f.zip)};${vEsc(f.country)}`);
        if (trim(f.note)) lines.push('NOTE:' + vEsc(f.note));
        lines.push('END:VCARD');
        return lines.join('\n');
      }
      case 'wifi': {
        if (!trim(f.ssid)) return '';
        const sec = f.security || 'WPA';
        let s = `WIFI:T:${sec};S:${wEsc(f.ssid)};`;
        if (sec !== 'nopass') s += `P:${wEsc(f.password)};`;
        if (f.hidden) s += 'H:true;';
        return s + ';';
      }
      case 'email': {
        if (!trim(f.to)) return '';
        const q = [];
        if (trim(f.subject)) q.push('subject=' + encodeURIComponent(f.subject));
        if (trim(f.body)) q.push('body=' + encodeURIComponent(f.body));
        return 'mailto:' + trim(f.to) + (q.length ? '?' + q.join('&') : '');
      }
      case 'sms': return trim(f.tel) ? `SMSTO:${tel(f.tel)}:${String(f.body || '')}` : '';
      case 'tel': return trim(f.tel) ? 'tel:' + tel(f.tel) : '';
      case 'geo': {
        const lat = parseFloat(String(f.lat).replace(',', '.')), lng = parseFloat(String(f.lng).replace(',', '.'));
        if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return '';
        return `geo:${lat},${lng}` + (trim(f.label) ? `?q=${lat},${lng}(${encodeURIComponent(f.label)})` : '');
      }
      case 'event': {
        if (!trim(f.summary) || !icsDate(f.start)) return '';
        const lines = ['BEGIN:VEVENT', 'SUMMARY:' + vEsc(f.summary), 'DTSTART:' + icsDate(f.start)];
        if (icsDate(f.end)) lines.push('DTEND:' + icsDate(f.end));
        if (trim(f.location)) lines.push('LOCATION:' + vEsc(f.location));
        if (trim(f.description)) lines.push('DESCRIPTION:' + vEsc(f.description));
        lines.push('END:VEVENT');
        return lines.join('\n');
      }
      default: return '';
    }
  }

  // ───── rozpoznawanie treści (wklejonej albo odczytanej z kodu) ─────
  const vUnesc = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;:\\])/g, '$1');

  function parseVCard(text) {
    const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
    const out = { tel: [], email: [] };
    for (const line of unfolded.split('\n')) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0].toUpperCase().replace(/^ITEM\d+\./, '');
      const val = line.slice(i + 1);
      if (key === 'FN') out.fn = vUnesc(val);
      else if (key === 'N' && !out.fn) out.fn = vUnesc(val.split(';').slice(0, 2).reverse().filter(Boolean).join(' '));
      else if (key === 'ORG') out.org = vUnesc(val.split(';')[0]);
      else if (key === 'TITLE') out.title = vUnesc(val);
      else if (key === 'TEL') out.tel.push(val.trim());
      else if (key === 'EMAIL') out.email.push(val.trim());
      else if (key === 'URL') out.url = val.trim();
    }
    return out;
  }

  // Rozkłada wizytówkę na pola formularza (do edycji wklejonej wizytówki)
  function vcardToFields(text) {
    const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
    const f = {};
    const tels = [];
    for (const line of unfolded.split('\n')) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const head = line.slice(0, i).toUpperCase();
      const key = head.split(';')[0].replace(/^ITEM\d+\./, '');
      const val = line.slice(i + 1);
      const parts = val.split(/(?<!\\);/).map(vUnesc);
      if (key === 'N') { f.last = parts[0] || ''; f.first = parts[1] || ''; }
      else if (key === 'FN' && !f.first && !f.last) { const w = vUnesc(val).split(' '); f.first = w.shift() || ''; f.last = w.join(' '); }
      else if (key === 'ORG') f.org = parts[0];
      else if (key === 'TITLE') f.title = vUnesc(val);
      else if (key === 'TEL') tels.push({ v: val.trim(), work: /WORK/.test(head) });
      else if (key === 'EMAIL' && !f.email) f.email = val.trim();
      else if (key === 'URL' && !f.url) f.url = val.trim();
      else if (key === 'ADR' && !f.city) { f.street = parts[2] || ''; f.city = parts[3] || ''; f.zip = parts[5] || ''; f.country = parts[6] || ''; }
      else if (key === 'NOTE') f.note = vUnesc(val);
    }
    const work = tels.find((t) => t.work), cell = tels.find((t) => t !== work);
    if (cell) f.tel = cell.v;
    if (work) f.tel2 = work.v;
    return f;
  }

  function parseWifi(text) {
    const body = text.slice(5);
    const out = {};
    const re = /([TSPH]):((?:\\.|[^;])*);/gi;
    let m;
    while ((m = re.exec(body))) out[m[1].toUpperCase()] = m[2].replace(/\\(.)/g, '$1');
    return { ssid: out.S || '', security: out.T || 'nopass', password: out.P || '', hidden: /^true$/i.test(out.H || '') };
  }

  // Zwraca { type, title, detail, ... } – opis do podglądu i akcji po odczytaniu kodu
  function detect(raw) {
    const text = String(raw || '');
    const t = text.trim();
    if (!t) return { type: 'empty', title: '' };
    if (/^BEGIN:VCARD/i.test(t)) {
      const v = parseVCard(t);
      return { type: 'vcard', title: v.fn || v.org || 'Wizytówka', detail: [v.org !== v.fn ? v.org : '', v.tel[0], v.email[0]].filter(Boolean).join(' · '), vcard: v };
    }
    if (/^MECARD:/i.test(t)) {
      const n = /N:([^;]*)/i.exec(t);
      return { type: 'vcard', title: n ? n[1].replace(',', ' ') : 'Wizytówka', detail: 'Format MECARD' };
    }
    if (/^WIFI:/i.test(t)) {
      const w = parseWifi(t);
      return { type: 'wifi', title: w.ssid || 'Sieć Wi-Fi', detail: w.security === 'nopass' ? 'Sieć otwarta' : 'Hasło: ' + (w.password ? '••••••' : 'brak'), wifi: w };
    }
    if (/^BEGIN:(VEVENT|VCALENDAR)/i.test(t)) {
      const s = /SUMMARY:(.*)/i.exec(t);
      return { type: 'event', title: s ? vUnesc(s[1].trim()) : 'Wydarzenie', detail: 'Wydarzenie w kalendarzu' };
    }
    if (/^mailto:/i.test(t)) {
      const addr = decodeURIComponent(t.slice(7).split('?')[0]);
      return { type: 'email', title: addr, detail: 'Nowa wiadomość e-mail', url: t };
    }
    if (/^MATMSG:/i.test(t)) { const to = /TO:([^;]*)/i.exec(t); return { type: 'email', title: to ? to[1] : 'E-mail', detail: 'Nowa wiadomość e-mail' }; }
    if (/^(SMSTO|SMS):/i.test(t)) {
      const [, num, ...msg] = t.split(':');
      return { type: 'sms', title: num, detail: msg.join(':') || 'SMS', tel: num, body: msg.join(':') };
    }
    if (/^tel:/i.test(t)) return { type: 'tel', title: t.slice(4), detail: 'Połączenie telefoniczne', url: t };
    if (/^geo:/i.test(t)) {
      const m = /^geo:(-?[\d.]+),(-?[\d.]+)/i.exec(t);
      return { type: 'geo', title: m ? `${m[1]}, ${m[2]}` : 'Lokalizacja', detail: 'Miejsce na mapie', lat: m && m[1], lng: m && m[2] };
    }
    if (/^otpauth(-migration)?:\/\//i.test(t)) return { type: 'otp', title: 'Klucz uwierzytelniania (2FA)', detail: 'Zeskanuj go w aplikacji 2FA' };
    if (/^https?:\/\/\S+$/i.test(t)) {
      let host = t;
      try { host = new URL(t).host; } catch (_) { /* zostaw */ }
      return { type: 'url', title: host, detail: t, url: t };
    }
    if (/^(www\.)[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) return { type: 'url', title: t.split('/')[0], detail: 'https://' + t, url: 'https://' + t };
    const lines = t.split('\n');
    return { type: 'text', title: lines[0].slice(0, 80), detail: lines.length > 1 ? `${lines.length} wierszy · ${t.length} znaków` : `${t.length} znaków` };
  }

  // Bajty tekstu w UTF-8 (tyle zajmuje w kodzie QR w trybie bajtowym)
  function byteLength(s) { return new TextEncoder().encode(s).length; }

  // Maksymalnie bajtów w jednym kodzie QR (wersja 40) dla poziomu korekcji
  const MAX_BYTES = { L: 2953, M: 2331, Q: 1663, H: 1273 };

  const Content = { TYPES, FIELDS, build, detect, parseVCard, vcardToFields, parseWifi, byteLength, MAX_BYTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = Content;
  else root.Content = Content;
})(typeof self !== 'undefined' ? self : this);
