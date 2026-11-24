'use strict';
// Base45 (RFC 9285): 2 bajty → 3 znaki z alfabetu trybu alfanumerycznego QR.
// Tryb alfanumeryczny zapisuje znak na 5,5 bitu, więc dane binarne zajmują w kodzie
// ~97% miejsca trybu bajtowego, a odczyt jest zawsze jednoznaczny (czysty ASCII) –
// także przez systemowe czytniki (BarcodeDetector), które zwracają tylko tekst.

(function (root) {
  const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  const LOOKUP = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

  function encodedLength(n) { return Math.floor(n / 2) * 3 + (n % 2) * 2; }

  // Największa liczba bajtów, która po zakodowaniu zmieści się w `chars` znakach
  function maxBytes(chars) { return Math.floor(chars / 3) * 2 + (chars % 3 === 2 ? 1 : 0); }

  function encode(bytes) {
    let out = '';
    const n = bytes.length;
    for (let i = 0; i + 1 < n; i += 2) {
      let x = bytes[i] * 256 + bytes[i + 1];
      const e = Math.floor(x / 2025); x -= e * 2025;
      const d = Math.floor(x / 45);
      out += ALPHABET[x - d * 45] + ALPHABET[d] + ALPHABET[e];
    }
    if (n % 2) {
      const x = bytes[n - 1];
      const d = Math.floor(x / 45);
      out += ALPHABET[x - d * 45] + ALPHABET[d];
    }
    return out;
  }

  // Zwraca Uint8Array albo null, gdy tekst nie jest poprawnym Base45
  function decode(str) {
    const n = str.length;
    if (n % 3 === 1) return null;
    const out = new Uint8Array(maxBytes(n));
    let o = 0;
    for (let i = 0; i < n; i += 3) {
      const c = str.charCodeAt(i), d = str.charCodeAt(i + 1);
      const a = c < 128 ? LOOKUP[c] : -1, b = d < 128 ? LOOKUP[d] : -1;
      if (a < 0 || b < 0) return null;
      if (i + 2 < n) {
        const f = str.charCodeAt(i + 2);
        const e = f < 128 ? LOOKUP[f] : -1;
        if (e < 0) return null;
        const x = a + b * 45 + e * 2025;
        if (x > 65535) return null;
        out[o++] = x >> 8; out[o++] = x & 255;
      } else {
        const x = a + b * 45;
        if (x > 255) return null;
        out[o++] = x;
      }
    }
    return out;
  }

  const Base45 = { ALPHABET, encode, decode, encodedLength, maxBytes };
  if (typeof module !== 'undefined' && module.exports) module.exports = Base45;
  else root.Base45 = Base45;
})(typeof self !== 'undefined' ? self : this);
