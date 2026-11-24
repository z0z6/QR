'use strict';
// Wersja webowa (GitHub Pages): kopia src/renderer do dist-web. Strona odbioru to dist-web/odbior.html.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'renderer');
const out = path.join(__dirname, '..', 'dist-web');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true, filter: (p) => !p.endsWith('.map') });
fs.writeFileSync(path.join(out, '.nojekyll'), '');
const n = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? n(path.join(dir, e.name)) : 1), 0);
console.log(`dist-web: ${n(out)} plików`);
