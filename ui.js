'use strict';
// Drobne komponenty interfejsu (bez frameworka)

(function () {
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const iconEl = (name, size, cls) => h('span', { class: 'icon-wrap ' + (cls || ''), html: window.icon(name, size) });

  function toast(text, kind = 'info', ms = 3800) {
    const root = document.getElementById('toast-root');
    const ic = kind === 'error' ? 'warn' : kind === 'success' ? 'checkCircle' : 'info';
    const el = h('div', { class: `toast ${kind}` }, iconEl(ic, 18), h('span', null, text));
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
  }

  // Warstwy (arkusze, ekrany) zamykane przyciskiem „Wstecz” na Androidzie i klawiszem Esc
  const layers = [];
  let ignorePop = 0;
  window.addEventListener('popstate', () => {
    if (ignorePop > 0) { ignorePop--; return; }
    const top = layers.pop();
    if (top) top(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && layers.length) { e.preventDefault(); layers[layers.length - 1](false); }
  });
  function pushLayer(close) { layers.push(close); try { history.pushState({ layer: layers.length }, ''); } catch (_) { /* brak */ } }
  function dropLayer(close, fromBack) {
    const i = layers.lastIndexOf(close);
    if (i >= 0) layers.splice(i, 1);
    if (!fromBack && i >= 0) { ignorePop++; try { history.back(); } catch (_) { ignorePop--; } }
  }
  function closeAllLayers() { while (layers.length) layers[layers.length - 1](false); }

  function sheet({ title, subtitle, body, actions = [], wide = false, onClose, cls }) {
    const root = document.getElementById('sheet-root');
    let closed = false;
    const close = (fromBack) => {
      if (closed) return;
      closed = true;
      dropLayer(close, fromBack === true);
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 240);
      if (onClose) onClose();
    };
    const panel = h('div', { class: 'sheet' + (wide ? ' wide' : '') + (cls ? ' ' + cls : '') },
      h('div', { class: 'sheet-grabber' }),
      title != null ? h('div', { class: 'sheet-head' },
        h('div', null, h('h2', null, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
        h('button', { class: 'icon-btn round', title: 'Zamknij', onclick: () => close(), html: window.icon('x', 15) })) : null,
      h('div', { class: 'sheet-body' }, body),
      actions.length ? h('div', { class: 'sheet-actions' }, actions.map((a) => {
        const b = h('button', { class: 'btn lg ' + (a.kind || ''), type: 'button' }, a.label);
        b.addEventListener('click', async () => {
          if (a.onClick) {
            let r;
            try { r = await busy(b, () => a.onClick(), a.busyLabel); } catch (err) { toast(err.message || String(err), 'error'); return; }
            if (r === false) return;
          }
          close();
        });
        return b;
      })) : null);
    const overlay = h('div', { class: 'sheet-overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, panel);
    root.appendChild(overlay);
    pushLayer(close);
    requestAnimationFrame(() => overlay.classList.add('show'));
    return { close, panel };
  }

  function confirm({ title, text, ok = 'OK', cancel = 'Anuluj', danger = false }) {
    return new Promise((resolve) => {
      let answered = false;
      const s = sheet({
        title, body: text ? h('p', { class: 'confirm-text' }, text) : null, cls: 'compact',
        onClose: () => { if (!answered) resolve(false); },
        actions: [
          { label: cancel, onClick: () => { answered = true; resolve(false); } },
          { label: ok, kind: danger ? 'danger-fill' : 'primary', onClick: () => { answered = true; resolve(true); } }
        ]
      });
      return s;
    });
  }

  function actionSheet({ title, subtitle, items }) {
    let s;
    const list = h('div', { class: 'action-list' }, items.filter(Boolean).map((it) => h('button', {
      class: 'action-item' + (it.danger ? ' danger' : ''), type: 'button',
      onclick: () => { s.close(); setTimeout(() => it.onClick(), 60); }
    }, it.icon ? iconEl(it.icon, 18) : null, h('span', null, it.label))));
    s = sheet({ title, subtitle, body: list, cls: 'compact' });
    return s;
  }

  function toggle(checked, onChange) {
    const input = h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) });
    return h('label', { class: 'switch' }, input, h('span', { class: 'slider' }));
  }

  function segmented(options, value, onChange) {
    const wrap = h('div', { class: 'segmented' });
    for (const o of options) {
      const b = h('button', { class: o.value === value ? 'active' : '', type: 'button' }, o.icon ? iconEl(o.icon, 14) : null, o.label);
      b.addEventListener('click', () => {
        wrap.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        onChange(o.value);
      });
      wrap.appendChild(b);
    }
    return wrap;
  }

  function select(options, value, onChange, attrs = {}) {
    const s = h('select', { class: 'input', ...attrs, onchange: (e) => onChange(e.target.value) },
      options.map((o) => h('option', { value: o.value, selected: o.value === value ? 'selected' : null }, o.label)));
    s.value = value;
    return s;
  }

  function spinner(size = 16) { return h('span', { class: 'spinner', style: { width: size + 'px', height: size + 'px' } }); }

  function group(title, rows, footer) {
    return h('section', { class: 'group' },
      title ? h('h3', { class: 'group-title' }, title) : null,
      h('div', { class: 'group-body' }, rows),
      footer ? h('p', { class: 'group-footer' }, footer) : null);
  }

  function row(label, control, opts = {}) {
    return h(opts.onClick ? 'button' : 'div', { class: 'row' + (opts.stack ? ' stack' : '') + (opts.onClick ? ' tappable' : '') + (opts.danger ? ' danger' : ''), type: opts.onClick ? 'button' : null, onclick: opts.onClick || null },
      h('div', { class: 'row-label' },
        opts.icon ? h('span', { class: 'row-icon', style: { background: opts.color || 'var(--accent)' }, html: window.icon(opts.icon, 14) }) : null,
        h('div', null, h('div', null, label), opts.hint ? h('div', { class: 'row-hint' }, opts.hint) : null)),
      h('div', { class: 'row-control' }, control));
  }

  async function busy(btn, fn, label) {
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '';
    btn.append(spinner(14), document.createTextNode(' ' + (label || 'Pracuję…')));
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
  }

  window.UI = { h, iconEl, toast, sheet, confirm, actionSheet, toggle, segmented, select, spinner, group, row, busy, pushLayer, dropLayer, closeAllLayers };
})();
