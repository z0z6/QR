'use strict';
// Odbiornik transmisji – wspólny dla aplikacji (zakładka „Odbierz”) i strony odbior.html,
// którą drugi telefon otwiera z kodu startowego bez instalowania czegokolwiek.

(function () {
  const { h, iconEl, toast } = window.UI;
  const T = window.Transfer;
  const P = window.Platform;

  const fmtB = T.formatBytes;

  function fileIcon(type) {
    if (/^image\//.test(type)) return 'image';
    if (/^text\//.test(type)) return 'text';
    return 'file';
  }

  // Okrągły wskaźnik postępu
  function ring(size = 74) {
    const r = (size - 8) / 2, len = 2 * Math.PI * r;
    const el = h('div', { class: 'rx-ring', style: { width: size + 'px', height: size + 'px' } });
    el.innerHTML = `<svg viewBox="0 0 ${size} ${size}"><circle class="t" cx="${size / 2}" cy="${size / 2}" r="${r}"/><circle class="p" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-dasharray="${len}" stroke-dashoffset="${len}"/></svg><span>0%</span>`;
    const p = el.querySelector('.p'), label = el.querySelector('span');
    el.set = (v) => { p.style.strokeDashoffset = String(len * (1 - v)); label.textContent = Math.floor(v * 100) + '%'; };
    return el;
  }

  // ───────────── wyniki ─────────────
  function resultView(out, info, actions) {
    const urls = [];
    const thumbs = (f) => {
      if (!/^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i.test(f.type) || f.data.length > 25 * 1024 * 1024) return null;
      const u = URL.createObjectURL(new Blob([f.data], { type: f.type }));
      urls.push(u);
      return h('img', { class: 'rx-thumb', src: u, alt: '' });
    };
    const save = async (f, btn) => {
      try {
        const r = await window.UI.busy(btn, () => P.saveFile(f.name, f.data, f.type), 'Zapisuję…');
        if (r && r !== 'shared') toast('Zapisano: ' + (typeof r === 'string' ? r : f.name), 'success');
      } catch (e) { toast(e.message || String(e), 'error'); }
    };

    const head = h('div', { class: 'rx-done-head' },
      h('div', { class: 'rx-check', html: window.icon('check', 34) }),
      h('h2', null, 'Odebrano'),
      h('p', { class: 'muted' }, [
        out.kind === 'text' ? 'Tekst' : out.files.length === 1 ? '1 plik' : `${out.files.length} pliki`,
        fmtB(out.size),
        info.seconds ? `${T.formatDuration(info.seconds)} (${fmtB(Math.round(info.bytes / Math.max(1, info.seconds)))}/s)` : null
      ].filter(Boolean).join(' · ')));

    let body;
    if (out.kind === 'text') {
      const d = window.Content.detect(out.text);
      const btns = [
        h('button', { class: 'btn lg', onclick: async () => { try { await P.copyText(out.text); toast('Skopiowano do schowka.', 'success'); } catch (_) { toast('Nie udało się skopiować – zaznacz tekst ręcznie.', 'error'); } } }, iconEl('copy', 16), 'Kopiuj')
      ];
      if (d.type === 'url') btns.unshift(h('button', { class: 'btn lg primary', onclick: () => P.openExternal(d.url) }, iconEl('globe', 16), 'Otwórz stronę'));
      if (d.type === 'vcard') btns.unshift(h('button', { class: 'btn lg primary', onclick: (e) => save({ name: (d.title || 'kontakt').replace(/\s+/g, '_') + '.vcf', type: 'text/vcard', data: new TextEncoder().encode(out.text) }, e.currentTarget) }, iconEl('person', 16), 'Zapisz kontakt'));
      if (P.canShare) btns.push(h('button', { class: 'btn lg', onclick: () => P.shareText(out.text).catch(() => {}) }, iconEl('share', 16), 'Udostępnij'));
      btns.push(h('button', { class: 'btn lg', onclick: (e) => save({ name: 'tekst.txt', type: 'text/plain', data: out.files[0].data }, e.currentTarget) }, iconEl('import', 16), 'Zapisz .txt'));
      body = h('div', { class: 'rx-text-wrap' },
        d.type === 'url' ? h('p', { class: 'rx-url-note' }, iconEl('info', 15), h('span', null, 'Link prowadzi do: ', h('b', null, d.title), '. Otwórz tylko, jeśli go oczekujesz.')) : null,
        h('pre', { class: 'rx-text' }, out.text),
        h('div', { class: 'rx-actions' }, btns));
    } else {
      const rows = out.files.map((f) => {
        const b = h('button', { class: 'btn', onclick: (e) => save(f, e.currentTarget) }, iconEl(P.isMobile ? 'share' : 'import', 15), P.isMobile ? 'Zapisz' : 'Zapisz…');
        return h('div', { class: 'rx-file' },
          thumbs(f) || h('span', { class: 'rx-file-ic', html: window.icon(fileIcon(f.type), 20) }),
          h('div', { class: 'rx-file-main' }, h('b', null, f.name), h('span', { class: 'muted' }, fmtB(f.data.length))),
          b);
      });
      const all = [];
      if (out.files.length > 1 && P.canSaveMany) {
        all.push(h('button', { class: 'btn lg primary full', onclick: async (e) => {
          try { const dir = await window.UI.busy(e.currentTarget, () => P.saveMany(out.files), 'Zapisuję…'); if (dir) toast('Zapisano w folderze ' + dir, 'success', 5000); } catch (err) { toast(err.message, 'error'); }
        } }, iconEl('folder', 16), 'Zapisz wszystkie w folderze…'));
      } else if (out.files.length > 1 && !P.isElectron && !P.isAndroid && navigator.canShare) {
        const files = out.files.map((f) => new File([f.data], f.name, { type: f.type }));
        if (navigator.canShare({ files })) all.push(h('button', { class: 'btn lg primary full', onclick: () => navigator.share({ files }).catch(() => {}) }, iconEl('share', 16), 'Zapisz / udostępnij wszystkie'));
      }
      body = h('div', null, h('div', { class: 'rx-files' }, rows), all,
        h('p', { class: 'rx-safe muted' }, iconEl('shield', 14), h('span', null, 'Pliki nie zostały otwarte automatycznie i nie trafiły do internetu. Otwieraj tylko te, których się spodziewasz.')));
    }
    const view = h('div', { class: 'rx-done' }, head, body,
      h('div', { class: 'rx-foot' }, actions));
    view.cleanup = () => urls.forEach((u) => URL.revokeObjectURL(u));
    return view;
  }

  // ───────────── odbiornik ─────────────
  // opts: { link, embedded, onSingle(text), onClose(), autoStart }
  function mount(container, opts = {}) {
    let link = opts.link || null;
    let rx = new T.Receiver(link ? { session: link.session, hash: link.hash } : {});
    let cam = null, uiTimer = null, closed = false, lastFrameAt = 0, otherAt = 0, singleAt = 0, resultEl = null;

    const video = h('video', { class: 'rx-video', playsinline: true, autoplay: true, muted: true });
    const prog = ring();
    const title = h('h3', null, 'Szukam kodu…');
    const line = h('p', { class: 'rx-line' }, 'Skieruj aparat na ekran nadawcy');
    const stats = h('p', { class: 'rx-stats' });
    const camBtn = h('button', { class: 'rx-round', title: 'Zmień aparat', html: window.icon('switchCam', 20), onclick: async () => { if (cam && !(await cam.switchCamera())) toast('To urządzenie ma tylko jeden aparat.'); } });
    const stopBtn = h('button', { class: 'btn lg rx-stop', onclick: () => stop(true) }, iconEl('stop', 15), 'Zatrzymaj');
    const live = h('div', { class: 'rx-live' },
      video,
      h('div', { class: 'rx-frame' }, h('span', { class: 'c tl' }), h('span', { class: 'c tr' }), h('span', { class: 'c bl' }), h('span', { class: 'c br' })),
      h('div', { class: 'rx-top' }, opts.embedded ? h('button', { class: 'rx-round', title: 'Zamknij', html: window.icon('x', 20), onclick: () => stop(true) }) : h('span'), camBtn),
      h('div', { class: 'rx-panel' }, prog, h('div', { class: 'rx-panel-main' }, title, line, stats), stopBtn));

    function expectText() {
      if (!link) return null;
      return [link.name || (link.count > 1 ? `${link.count} pliki` : 'dane'), link.bytes ? fmtB(link.bytes) : null].filter(Boolean).join(' · ');
    }

    function renderIntro(errorText) {
      const exp = expectText();
      const steps = h('ol', { class: 'rx-steps' },
        h('li', null, 'Naciśnij ', h('b', null, 'Odbieraj'), ' i zezwól na użycie aparatu.'),
        h('li', null, 'Skieruj aparat na ruchomy kod na ekranie nadawcy – tak, by kod wypełniał ramkę.'),
        h('li', null, 'Gdy nadawca naciśnie ', h('b', null, 'Start'), ', pasek postępu zacznie rosnąć. Trzymaj telefon nieruchomo do końca.'));
      container.replaceChildren(h('div', { class: 'rx-intro' },
        h('div', { class: 'logo', html: window.icon('inbox', 38) }),
        h('h1', null, exp ? 'Odbierz dane' : 'Odbiornik QR'),
        exp ? h('div', { class: 'rx-expect' }, iconEl(link.count > 1 ? 'folder' : /\.txt$|^tekst/i.test(link.name) ? 'text' : 'file', 20), h('div', null, h('b', null, link.name || 'Dane'), h('span', { class: 'muted' }, link.bytes ? fmtB(link.bytes) + (link.count > 1 ? ` · ${link.count} pliki` : '') : 'Transmisja z innego urządzenia'))) :
          h('p', { class: 'muted' }, 'Odbieraj pliki i tekst przesyłane ruchomym kodem QR z ekranu innego urządzenia.'),
        steps,
        errorText ? h('div', { class: 'note warn' }, iconEl('warn', 16), h('span', null, errorText)) : null,
        h('button', { class: 'btn primary xl full', onclick: start }, iconEl('camera', 18), 'Odbieraj'),
        h('p', { class: 'rx-safe muted' }, iconEl('shield', 14), h('span', null, 'Dane płyną wyłącznie obrazem: z ekranu nadawcy do aparatu tego urządzenia. Nic nie jest wysyłane do internetu, a odbiór kończy się sam po otrzymaniu kompletu – wtedy aparat się wyłącza.')),
        opts.embedded ? h('button', { class: 'btn plain full', onclick: () => stop(true) }, 'Anuluj') : null));
    }

    async function start() {
      container.replaceChildren(live);
      title.textContent = link ? 'Czekam na transmisję…' : 'Szukam kodu…';
      line.textContent = 'Skieruj aparat na ekran nadawcy';
      stats.textContent = expectText() || '';
      prog.set(rx.progress);
      try {
        cam = await window.QR.startCamera(video, onText, { invert: 'dontInvert' });
        P.keepAwake(true, false);
      } catch (e) {
        cam = null;
        renderIntro(window.QR.cameraError(e));
        return;
      }
      clearInterval(uiTimer);
      uiTimer = setInterval(updateUi, 400);
      // pokaż przycisk zmiany aparatu tylko, gdy jest więcej niż jeden
      navigator.mediaDevices.enumerateDevices().then((d) => { camBtn.style.visibility = d.filter((x) => x.kind === 'videoinput').length > 1 ? 'visible' : 'hidden'; }).catch(() => {});
    }

    function onText(text) {
      if (closed || resultEl) return;
      const r = rx.feed(text);
      const now = Date.now();
      if (r === 'frame' || r === 'dup') {
        lastFrameAt = now;
        if (rx.complete) complete();
        return;
      }
      if (r === 'other') { otherAt = now; return; }
      if (r === 'not-frame') {
        const l = T.parseLink(text);
        if (l) {
          // kod startowy – przypisz odbiór do tej transmisji
          if (!link || link.session !== l.session) { link = l; rx = new T.Receiver({ session: l.session, hash: l.hash }); stats.textContent = expectText(); title.textContent = 'Czekam na transmisję…'; }
          return;
        }
        if (opts.onSingle && !rx.decoder) { stop(false); opts.onSingle(text); return; }
        singleAt = now;
      }
    }

    function updateUi() {
      const now = Date.now();
      prog.set(rx.progress);
      if (rx.decoder) {
        const got = Math.min(rx.total, Math.round(rx.progress * rx.total));
        const sp = rx.speed;
        const left = sp > 0 ? (rx.total - got) / sp : Infinity;
        title.textContent = now - lastFrameAt > 2500 ? 'Zgubiłem kod – popraw ustawienie' : 'Odbieram…';
        line.textContent = now - lastFrameAt > 2500 ? 'Kod cały w ramce, bez odblasków; trochę bliżej albo dalej' : `${fmtB(got)} z ${fmtB(rx.total)}`;
        stats.textContent = sp > 0 ? `${fmtB(Math.round(sp))}/s · zostało ok. ${T.formatDuration(left * 1.02)}` : '';
      } else if (now - otherAt < 3000) {
        title.textContent = 'To inna transmisja';
        line.textContent = 'Ten kod startowy dotyczy innego nadawcy. Zeskanuj aktualny kod startowy.';
      } else if (now - singleAt < 3000) {
        title.textContent = 'To zwykły kod QR';
        line.textContent = 'Czekam na ruchomy kod transmisji';
      }
    }

    async function complete() {
      clearInterval(uiTimer);
      if (navigator.vibrate) navigator.vibrate([30, 40, 60]);
      const seconds = (rx.lastAt - rx.startedAt) / 1000;
      const bytes = rx.total;
      prog.set(1);
      title.textContent = 'Sprawdzam dane…';
      if (cam) { cam.stop(); cam = null; }
      P.keepAwake(false);
      try {
        const out = await rx.finish();
        resultEl = resultView(out, { seconds, bytes }, [
          h('button', { class: 'btn lg full', onclick: () => reset(true) }, iconEl('refresh', 16), 'Odbierz kolejne'),
          opts.embedded ? h('button', { class: 'btn lg plain full', onclick: () => stop(true) }, 'Gotowe') : null
        ]);
        container.replaceChildren(resultEl);
        if (opts.onDone) opts.onDone(out);
      } catch (e) {
        resultEl = null;
        rx = new T.Receiver(link ? { session: link.session, hash: link.hash } : {});
        renderIntro(e.message + ' Spróbuj odebrać jeszcze raz.');
      }
    }

    function reset(again) {
      if (resultEl && resultEl.cleanup) resultEl.cleanup();
      resultEl = null;
      if (!opts.keepLink) link = null;
      rx = new T.Receiver(link ? { session: link.session, hash: link.hash } : {});
      if (again) start(); else renderIntro();
    }

    function stop(userClosed) {
      clearInterval(uiTimer);
      if (cam) { cam.stop(); cam = null; }
      P.keepAwake(false);
      if (userClosed && opts.onClose) { closed = true; if (resultEl && resultEl.cleanup) resultEl.cleanup(); opts.onClose(); return; }
      if (userClosed) renderIntro();
    }

    if (opts.autoStart) start(); else renderIntro();
    return {
      stop: () => { closed = true; stop(false); if (resultEl && resultEl.cleanup) resultEl.cleanup(); },
      get busy() { return !!cam || !!resultEl; }
    };
  }

  window.RX = { mount, resultView, ring };
})();
