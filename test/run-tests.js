'use strict';
// Testy silnika (bez Electrona): node test/run-tests.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..', 'src', 'renderer');
const Base45 = require(path.join(R, 'core', 'base45.js'));
const Fountain = require(path.join(R, 'core', 'fountain.js'));
const Transfer = require(path.join(R, 'core', 'transfer.js'));
const Content = require(path.join(R, 'core', 'content.js'));
const qrcode = require(path.join(R, 'vendor', 'qrcode-generator.js'));
const jsQR = require(path.join(R, 'vendor', 'jsQR.js'));

let passed = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// deterministyczne „losowe” bajty
function bytes(n, seed = 1) {
  const r = Fountain.rng(seed);
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(r() * 256);
  return b;
}

// ───────────── Base45 ─────────────
test('Base45: wektory z RFC 9285', () => {
  const e = (s) => Base45.encode(new TextEncoder().encode(s));
  assert.strictEqual(e('AB'), 'BB8');
  assert.strictEqual(e('Hello!!'), '%69 VD92EX0');
  assert.strictEqual(e('base-45'), 'UJCLQE7W581');
  assert.strictEqual(new TextDecoder().decode(Base45.decode('QED8WEX0')), 'ietf!');
  assert.strictEqual(Base45.decode('GGW'), null, 'wartość > 65535 musi być odrzucona');
  assert.strictEqual(Base45.decode('abc'), null, 'małe litery spoza alfabetu');
});

test('Base45: losowe dane w obie strony i długości', () => {
  for (const n of [0, 1, 2, 3, 99, 100, 1001]) {
    const b = bytes(n, n + 7);
    const s = Base45.encode(b);
    assert.strictEqual(s.length, Base45.encodedLength(n));
    assert.deepStrictEqual(Base45.decode(s), b);
    assert.ok(Base45.maxBytes(s.length) >= n);
  }
});

// ───────────── kody fontannowe ─────────────
function simulate(size, B, loss, seed) {
  const data = bytes(size, seed);
  const enc = new Fountain.Encoder(data, B);
  const dec = new Fountain.Decoder(enc.K, B, data.length);
  const r = Fountain.rng(seed * 31 + 5);
  let id = 0, sent = 0;
  while (!dec.done) {
    const s = id++;
    sent++;
    if (r() < loss) continue;
    dec.add(s, enc.symbol(s));
    if (sent > enc.K * 20 + 200) throw new Error('dekoder nie kończy');
  }
  assert.deepStrictEqual(dec.result(), data);
  return { K: enc.K, sent, received: dec.received };
}

test('Fountain: bez strat wystarcza dokładnie K klatek', () => {
  const r = simulate(50000, 800, 0, 3);
  assert.strictEqual(r.sent, r.K);
});

test('Fountain: straty 10/30/50% – dane kompletne, mały narzut', () => {
  const report = [];
  for (const loss of [0.1, 0.3, 0.5]) {
    let over = 0;
    const runs = 6;
    for (let i = 0; i < runs; i++) {
      const r = simulate(120000, 820, loss, 11 + i * 7 + loss * 100);
      over += r.received / r.K;
    }
    const avg = over / runs;
    report.push(`${Math.round(loss * 100)}% strat → odebrano ${avg.toFixed(3)}×K`);
    assert.ok(avg < 1.03, `narzut za duży przy stratach ${loss}: ${avg}`);
  }
  console.log('      ' + report.join('; '));
});

test('Fountain: dołączenie w połowie transmisji (bez części systematycznej)', () => {
  const data = bytes(30000, 9);
  const enc = new Fountain.Encoder(data, 500);
  const dec = new Fountain.Decoder(enc.K, 500, data.length);
  let id = Math.floor(enc.K / 2), n = 0;
  while (!dec.done) { dec.add(id, enc.symbol(id)); id++; n++; assert.ok(n < enc.K * 3); }
  assert.deepStrictEqual(dec.result(), data);
});

test('Fountain: mały plik (1 blok) i duplikaty', () => {
  const data = bytes(10, 2);
  const enc = new Fountain.Encoder(data, 100);
  const dec = new Fountain.Decoder(enc.K, 100, data.length);
  assert.strictEqual(enc.K, 1);
  dec.add(5, enc.symbol(5));
  assert.ok(dec.done);
  assert.strictEqual(dec.add(5, enc.symbol(5)), false);
  assert.deepStrictEqual(dec.result(), data);
});

// ───────────── protokół ─────────────
test('Transfer: rozmiar bloku mieści się w kodzie QR każdej wersji', () => {
  for (const ecc of ['L', 'M', 'Q', 'H']) {
    for (const v of [10, 14, 20, 26, 30, 40]) {
      const B = Transfer.blockSizeFor(v, ecc);
      const text = Transfer.packFrame({ flags: 0, session: 1, length: 1000, blockSize: B, id: 0, payload: new Uint8Array(B) });
      const q = qrcode(v, ecc);
      q.addData(text, 'Alphanumeric');
      q.make(); // rzuci wyjątek przy przepełnieniu
      assert.ok(Base45.encodedLength(Transfer.HEADER + B + 2) > Transfer.CAPACITY[ecc][v - 1] - 1, 'blok mógłby być większy');
    }
  }
});

test('Transfer: ramka – CRC wykrywa uszkodzenie, obce kody są ignorowane', () => {
  const p = bytes(300, 4);
  const t = Transfer.packFrame({ flags: 1, session: 0xdeadbeef, length: 12345, blockSize: 300, id: 77, payload: p });
  const f = Transfer.parseFrame(t);
  assert.strictEqual(f.session, 0xdeadbeef);
  assert.strictEqual(f.id, 77);
  assert.strictEqual(f.flags, 1);
  assert.deepStrictEqual(Array.from(f.payload), Array.from(p));
  const broken = t.slice(0, 60) + (t[60] === 'A' ? 'B' : 'A') + t.slice(61);
  assert.strictEqual(Transfer.parseFrame(broken), null);
  assert.strictEqual(Transfer.parseFrame('https://example.com'), null);
  assert.strictEqual(Transfer.parseFrame('HELLO WORLD THIS IS A NORMAL QR CODE TEXT 123'), null);
});

test('Transfer: link startowy', () => {
  const link = Transfer.buildLink('https://z0z6.github.io/QR/odbior.html', { session: 0x0badf00d, hashHex: 'ab'.repeat(32), name: 'Zdjęcie #1.jpg', bytes: 2048, count: 1 });
  assert.ok(link.startsWith('https://z0z6.github.io/QR/odbior.html#s=0badf00d&h=' + 'ab'.repeat(16)));
  const p = Transfer.parseLink(link);
  assert.strictEqual(p.session, 0x0badf00d);
  assert.strictEqual(p.hash, 'ab'.repeat(16));
  assert.strictEqual(p.name, 'Zdjęcie #1.jpg');
  assert.strictEqual(p.bytes, 2048);
  assert.strictEqual(Transfer.parseLink('https://example.com/#s=zz'), null);
});

// Pełna ścieżka: dane → ramki → obraz kodu QR → jsQR → dekoder → te same pliki
function renderRgba(text, version, ecc, scale) {
  const q = qrcode(version, ecc);
  q.addData(text, 'Alphanumeric');
  q.make();
  const n = q.getModuleCount(), quiet = 4, size = (n + quiet * 2) * scale;
  const img = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!q.isDark(r, c)) continue;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
      img[i] = img[i + 1] = img[i + 2] = 0;
    }
  }
  return { img, size };
}

test('Transfer: koniec-koniec przez prawdziwe kody QR (jsQR), 25% klatek zgubionych', async () => {
  const files = [
    { name: 'raport.pdf', type: 'application/pdf', data: bytes(9000, 21) },
    { name: 'notatka.txt', type: 'text/plain', data: new TextEncoder().encode('Zażółć gęślą jaźń\n'.repeat(200)) }
  ];
  const built = await Transfer.buildPayload({ kind: 'files', files });
  assert.ok(built.flags & 1, 'tekst powinien się skompresować');
  const preset = Transfer.PRESETS.normal;
  const sender = new Transfer.Sender(built, { version: preset.version, ecc: preset.ecc });
  const link = Transfer.parseLink(Transfer.buildLink(null, { session: sender.session, hashHex: built.hashHex }));
  const rx = new Transfer.Receiver({ session: link.session, hash: link.hash });
  assert.strictEqual(rx.feed(Transfer.packFrame({ flags: 0, session: (sender.session + 1) >>> 0, length: 999, blockSize: 100, id: 0, payload: new Uint8Array(100) })), 'other');
  const r = Fountain.rng(99);
  let frames = 0;
  while (!rx.complete) {
    const text = sender.nextFrame();
    frames++;
    if (r() < 0.25) continue;
    const { img, size } = renderRgba(text, preset.version, preset.ecc, 3);
    const res = jsQR(img, size, size, { inversionAttempts: 'dontInvert' });
    assert.ok(res, 'jsQR nie odczytał ramki');
    assert.strictEqual(res.data, text);
    rx.feed(res.data);
    assert.ok(frames < sender.K * 3);
  }
  const out = await rx.finish();
  assert.strictEqual(out.files.length, 2);
  assert.strictEqual(out.files[0].name, 'raport.pdf');
  assert.deepStrictEqual(out.files[0].data, files[0].data);
  assert.deepStrictEqual(out.files[1].data, files[1].data);
  console.log(`      ${built.payload.length} B w ${sender.K} blokach, wysłano ${frames} klatek`);
});

test('Transfer: tekst i weryfikacja skrótu z linku', async () => {
  const built = await Transfer.buildPayload({ kind: 'text', text: 'Cześć! 👋' });
  const s = new Transfer.Sender(built, { version: 10, ecc: 'L' });
  const good = new Transfer.Receiver({ session: s.session, hash: built.hashHex.slice(0, 32) });
  const bad = new Transfer.Receiver({ session: s.session, hash: '0'.repeat(32) });
  while (!good.complete) { const f = s.nextFrame(); good.feed(f); bad.feed(f); }
  assert.strictEqual((await good.finish()).text, 'Cześć! 👋');
  await assert.rejects(bad.finish(), /nie pasują/);
});

// ───────────── treść ─────────────
test('Content: wizytówka vCard 3.0 i odczyt z powrotem', () => {
  const v = Content.build('vcard', { first: 'Jan', last: 'Kowalski', org: 'Firma; S.A.', tel: '+48 600 100 200', email: 'jan@example.com', city: 'Łódź', note: 'Linia 1\nLinia 2' });
  assert.ok(v.startsWith('BEGIN:VCARD\nVERSION:3.0\nN:Kowalski;Jan;;;\nFN:Jan Kowalski'));
  assert.ok(v.includes('ORG:Firma\\; S.A.'));
  assert.ok(v.includes('NOTE:Linia 1\\nLinia 2'));
  const d = Content.detect(v);
  assert.strictEqual(d.type, 'vcard');
  assert.strictEqual(d.title, 'Jan Kowalski');
  const f = Content.vcardToFields(v);
  assert.strictEqual(f.first, 'Jan');
  assert.strictEqual(f.org, 'Firma; S.A.');
  assert.strictEqual(f.city, 'Łódź');
  assert.strictEqual(f.note, 'Linia 1\nLinia 2');
});

test('Content: Wi-Fi z ucieczką znaków specjalnych', () => {
  const w = Content.build('wifi', { ssid: 'Dom;5G', security: 'WPA', password: 'a:b\\c', hidden: true });
  assert.strictEqual(w, 'WIFI:T:WPA;S:Dom\\;5G;P:a\\:b\\\\c;H:true;;');
  const p = Content.parseWifi(w);
  assert.strictEqual(p.ssid, 'Dom;5G');
  assert.strictEqual(p.password, 'a:b\\c');
  assert.strictEqual(p.hidden, true);
});

test('Content: pozostałe formaty i rozpoznawanie', () => {
  assert.strictEqual(Content.build('email', { to: 'a@b.pl', subject: 'Zażółć' }), 'mailto:a@b.pl?subject=Za%C5%BC%C3%B3%C5%82%C4%87');
  assert.strictEqual(Content.build('sms', { tel: '+48 600-100-200', body: 'Hej' }), 'SMSTO:+48600100200:Hej');
  assert.strictEqual(Content.build('tel', { tel: '600 100 200' }), 'tel:600100200');
  assert.strictEqual(Content.build('geo', { lat: '52,2297', lng: '21.0122' }), 'geo:52.2297,21.0122');
  assert.strictEqual(Content.build('geo', { lat: '200', lng: '0' }), '');
  assert.ok(Content.build('event', { summary: 'Zebranie', start: '2026-12-01T10:30' }).includes('DTSTART:20261201T103000'));
  assert.strictEqual(Content.detect('https://example.com/a?b=1').type, 'url');
  assert.strictEqual(Content.detect('www.onet.pl').url, 'https://www.onet.pl');
  assert.strictEqual(Content.detect('WIFI:T:WPA;S:x;P:y;;').type, 'wifi');
  assert.strictEqual(Content.detect('tel:123').type, 'tel');
  assert.strictEqual(Content.detect('zwykły tekst').type, 'text');
});

test('Wersja w package.json i platform.js jest taka sama', () => {
  const pkg = require('../package.json');
  const plat = fs.readFileSync(path.join(R, 'platform.js'), 'utf8');
  const m = /APP_VERSION = '([^']+)'/.exec(plat);
  assert.ok(m, 'brak APP_VERSION w platform.js');
  assert.strictEqual(m[1], pkg.version);
  const sw = fs.readFileSync(path.join(R, 'sw.js'), 'utf8');
  assert.ok(sw.includes(`qr-${pkg.version}`), 'sw.js: nazwa pamięci podręcznej musi zawierać wersję');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n    ')); }
  }
  console.log(`\n${passed} zaliczonych, ${failed} niezaliczonych`);
  process.exit(failed ? 1 : 0);
})();
