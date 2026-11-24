'use strict';
// Strona odbioru (odbior.html): otwierana z kodu startowego na dowolnym telefonie lub komputerze.
// Nie wymaga instalacji. Parametry transmisji są w części adresu po „#”, której przeglądarka
// nie wysyła do serwera; strona nie łączy się z niczym poza pobraniem własnych plików.

(function () {
  const root = document.getElementById('rx-root');
  let handle = null;

  function applyTheme() {
    let t = 'system';
    try { t = (JSON.parse(localStorage.getItem('qr.prefs') || '{}').theme) || 'system'; } catch (_) { /* brak */ }
    if (t !== 'system') document.documentElement.dataset.theme = t;
  }

  function mount() {
    if (handle) handle.stop();
    const link = window.Transfer.parseLink(location.hash);
    handle = window.RX.mount(root, { link, keepLink: true });
    document.title = link && link.name ? 'Odbierz: ' + link.name : 'Odbiornik QR';
  }

  applyTheme();
  window.addEventListener('hashchange', mount);
  mount();

  // praca bez internetu po pierwszej wizycie
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
