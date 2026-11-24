'use strict';
// Kod fontannowy (systematyczny, losowy liniowy nad GF(2)).
//
// Dane dzielimy na K bloków po B bajtów. Symbol o numerze id < K to po prostu blok id
// (pierwsze „okrążenie” przesyła dane wprost), a każdy dalszy symbol to XOR losowo
// wybranej połowy bloków (ziarno = numer symbolu, więc odbiorca wie, których).
// Odbiorca nie musi łapać konkretnych klatek – wystarczy mu K dowolnych, liniowo
// niezależnych symboli (w praktyce K + 1–2). Dekoder utrzymuje macierz w postaci
// schodkowej zredukowanej (eliminacja Gaussa–Jordana na bieżąco), więc gdy przyjdzie
// ostatni potrzebny symbol, dane są od razu gotowe – bez długiego składania na końcu.

(function (root) {
  // ───── deterministyczny generator liczb losowych (identyczny u nadawcy i odbiorcy) ─────
  function mix32(a, b) {
    let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
    return h >>> 0;
  }
  function rng32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    };
  }
  const rng = (seed) => { const r = rng32(seed); return () => r() / 4294967296; };

  // Maska bloków symbolu `id` (Uint32Array, bit i = blok i)
  function maskFor(id, K) {
    const W = (K + 31) >> 5;
    const bits = new Uint32Array(W);
    if (id < K) { bits[id >> 5] = 1 << (id & 31); return bits; }
    const r = rng32(mix32(id, K));
    for (let w = 0; w < W; w++) bits[w] = r();
    const tail = K & 31;
    if (tail) bits[W - 1] &= (1 << tail) - 1;
    let any = 0;
    for (let w = 0; w < W; w++) any |= bits[w];
    if (!any) bits[0] = 1;
    return bits;
  }

  function indicesFor(id, K) {
    const bits = maskFor(id, K), out = [];
    for (let w = 0; w < bits.length; w++) {
      let m = bits[w];
      while (m) { const b = m & -m; out.push(w * 32 + (31 - Math.clz32(b))); m ^= b; }
    }
    return out;
  }

  const padLen = (B) => (B + 3) & ~3;
  function xorInto(dst, src) { for (let i = 0; i < dst.length; i++) dst[i] ^= src[i]; }
  function popcount(bits) {
    let n = 0;
    for (let i = 0; i < bits.length; i++) { let v = bits[i]; v -= (v >>> 1) & 0x55555555; v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); n += (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24); }
    return n;
  }
  function lowestBit(bits) {
    for (let w = 0; w < bits.length; w++) if (bits[w]) return w * 32 + (31 - Math.clz32(bits[w] & -bits[w]));
    return -1;
  }

  class Encoder {
    constructor(data, blockSize) {
      this.B = blockSize;
      this.L = data.length;
      this.K = Math.max(1, Math.ceil(data.length / blockSize));
      const P = padLen(blockSize);
      this.blocks = [];
      for (let i = 0; i < this.K; i++) {
        const b = new Uint8Array(P);
        b.set(data.subarray(i * blockSize, Math.min(data.length, (i + 1) * blockSize)));
        this.blocks.push(new Uint32Array(b.buffer));
      }
    }
    symbol(id) {
      if (id < this.K) return new Uint8Array(this.blocks[id].buffer, 0, this.B);
      const acc = new Uint32Array(this.blocks[0].length);
      const bits = maskFor(id, this.K);
      for (let w = 0; w < bits.length; w++) {
        let m = bits[w];
        while (m) { const b = m & -m; xorInto(acc, this.blocks[w * 32 + (31 - Math.clz32(b))]); m ^= b; }
      }
      return new Uint8Array(acc.buffer, 0, this.B);
    }
  }

  class Decoder {
    constructor(K, blockSize, totalLength) {
      this.K = K;
      this.B = blockSize;
      this.L = totalLength;
      this.W = (K + 31) >> 5;
      this.D = padLen(blockSize) / 4;
      this.rowOf = new Array(K).fill(null);   // wiersz z osią w danej kolumnie
      this.isPivot = new Uint32Array(this.W);
      this.dense = new Set();                 // wiersze z więcej niż jedną kolumną
      this.rank = 0;
      this.seen = new Set();
      this.received = 0;
    }

    get done() { return this.rank === this.K; }
    get progress() { return this.rank / this.K; }
    get knownCount() { return this.rank; }

    // Dodaje symbol. Zwraca true, gdy wniósł nową informację.
    add(id, payload) {
      if (this.done || this.seen.has(id)) return false;
      this.seen.add(id);
      this.received++;
      const buf = new Uint8Array(this.D * 4);
      buf.set(payload.subarray(0, this.B));
      const data = new Uint32Array(buf.buffer);
      const bits = maskFor(id, this.K);

      // 1. usuń z wiersza wszystkie kolumny, które mają już oś (wiersze osi nie zawierają innych osi)
      for (let w = 0; w < this.W; w++) {
        let m = bits[w] & this.isPivot[w];
        while (m) {
          const c = w * 32 + (31 - Math.clz32(m & -m));
          const p = this.rowOf[c];
          xorInto(data, p.data);
          if (p.bits) xorInto(bits, p.bits); else bits[w] ^= 1 << (c & 31);
          m = bits[w] & this.isPivot[w];
        }
      }
      const c = lowestBit(bits);
      if (c < 0) return false; // symbol zależny od już znanych – nic nowego

      // 2. nowa oś w kolumnie c: usuń c z pozostałych wierszy, żeby zachować postać zredukowaną
      const single = popcount(bits) === 1;
      const cw = c >> 5, cm = 1 << (c & 31);
      for (const r of this.dense) {
        if (!(r.bits[cw] & cm)) continue;
        xorInto(r.bits, bits);
        xorInto(r.data, data);
        if (popcount(r.bits) === 1) { r.bits = null; this.dense.delete(r); }
      }
      const row = { col: c, bits: single ? null : bits, data };
      this.rowOf[c] = row;
      this.isPivot[cw] |= cm;
      this.rank++;
      if (!single) this.dense.add(row);
      return true;
    }

    result() {
      if (!this.done) return null;
      const out = new Uint8Array(this.L);
      for (let i = 0; i < this.K; i++) {
        const start = i * this.B;
        if (start >= this.L) break;
        out.set(new Uint8Array(this.rowOf[i].data.buffer, 0, Math.min(this.B, this.L - start)), start);
      }
      return out;
    }
  }

  const Fountain = { Encoder, Decoder, indicesFor, maskFor, rng, mix32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = Fountain;
  else root.Fountain = Fountain;
})(typeof self !== 'undefined' ? self : this);
