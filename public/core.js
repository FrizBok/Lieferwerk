'use strict';

/* ===================== Zustand & Konstanten ===================== */
const $app = document.getElementById('app');
const state = { user: null, canSeeDeposit: false, showDeposit: true, timer: null };
const ROUTES = [];
const hasRole = (r) => !!state.user && (state.user.roles || [state.user.role]).includes(r);
const roleText = (roles) => (roles || []).map((r) => ROLE_LABELS[r] || r).join(' + ');

const STATUS_LABELS = {
  neu: 'Neu',
  packen: 'Wird gepackt',
  gepackt: 'Gepackt',
  unterwegs: 'Unterwegs',
  geliefert: 'Geliefert',
  storniert: 'Storniert',
};
const ROLE_LABELS = { admin: 'Administrator', packer: 'Packer', driver: 'Fahrer' };
const FLEET_STATE_LABELS = { verfuegbar: 'Frei', unterwegs: 'Unterwegs', werkstatt: 'Werkstatt' };
const VEHICLE_TYPES = [
  ['transporter', 'Transporter'],
  ['lkw', 'LKW'],
  ['pkw', 'PKW'],
  ['sonstiges', 'Sonstiges'],
];
const TRAILER_TYPES = [
  ['standard', 'Standard-Anhänger'],
  ['kuehl', 'Kühlanhänger'],
  ['getraenke', 'Getränkeanhänger'],
  ['sonstiges', 'Sonstiges'],
];

/* ===================== Design (hell/dunkel) & Icons ===================== */
function storeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } }
function currentTheme() {
  const t = storeGet('lw_theme');
  if (t === 'dark' || t === 'light') return t;
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', t === 'dark' ? '#0f1115' : '#d6122b');
}
applyTheme(currentTheme());

const ICONS = {
  home: 'M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10',
  orders: 'M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6',
  pack: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7',
  truck: 'M2 6h11v10H2zM13 9h4l4 4v3h-8zM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M17 4.5a3.5 3.5 0 0 1 0 6.5M18.5 14.3c2 .7 3 2.6 3 5.7',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
  refresh: 'M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  logout: 'M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 16l4-4-4-4M20 12H9',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  chevrons: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  trailer: 'M2 6h15v9H2zM17 11h4v4h-4zM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 15h-3M2 15v2',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  dots: 'M12 6h.01M12 12h.01M12 18h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6',
};
function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.home);
  svg.append(p);
  return svg;
}

/* ===================== DOM-Helfer (kein innerHTML -> kein XSS) ===================== */
function appendAll(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// replaceChildren(null) wuerde sonst den Text "null" anzeigen
const nativeReplaceChildren = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...nodes) {
  return nativeReplaceChildren.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false && n !== true));
};

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (['checked', 'selected', 'disabled', 'hidden', 'required', 'multiple', 'readOnly'].includes(k)) el[k] = true;
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendAll(el, children);
  if (value !== undefined) el.value = value;
  return el;
}

/* ===================== Formatierung ===================== */
const eurFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const eur = (cents) => eurFmt.format((cents || 0) / 100);
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '');

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "1,50" -> 150 (Cent); leer -> null; ungueltig -> Fehler */
function parseMoney(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).trim().replace(/\s/g, '').replace('€', '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Ungültiger Betrag: "${str}"`);
  return Math.round(n * 100);
}

function moneyInput(cents) {
  return cents === null || cents === undefined ? '' : (cents / 100).toFixed(2).replace('.', ',');
}

/** "2,5" -> 2.5 ; ungueltig -> NaN */
function parseNum(str) {
  const s = String(str ?? '').trim().replace(',', '.');
  return s === '' ? NaN : Number(s);
}

function fmtQty(n) {
  return String(Math.round(n * 1000) / 1000).replace('.', ',');
}

function addressLine(o) {
  return [o.address, [o.postal_code, o.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

/* ===================== API & Meldungen ===================== */
async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('Keine Verbindung zum Server');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* leere Antwort */
  }
  if (res.status === 401 && path !== '/login' && path !== '/me') {
    if (state.user) {
      state.user = null;
      if (typeof showLogin === 'function') showLogin('Bitte neu anmelden.');
    }
    throw new Error('Nicht angemeldet');
  }
  if (!res.ok) throw new Error((data && data.error) || `Fehler ${res.status}`);
  return data;
}

function toast(message, kind = '', ms = 3500) {
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

function toastWarnings(warnings) {
  for (const w of warnings || []) toast(`⚠ ${w}`, 'warn', 8000);
}

function errorBox(e) {
  return h('div', { class: 'notice error' }, e.message || String(e));
}

function badge(cls, text) {
  return h('span', { class: `badge ${cls}` }, text);
}
const statusBadge = (s) => badge(s, STATUS_LABELS[s] || s);

function pageHead(title, ...actions) {
  return h('div', { class: 'page-head' }, h('h1', {}, title), h('div', { class: 'spacer' }), ...actions);
}

function applyDepositVisibility() {
  document.body.classList.toggle('hide-deposit', !state.showDeposit);
}

function progressBar(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = h('i', {});
  bar.style.width = `${pct}%`;
  return h('div', { class: 'progress', title: `${done} von ${total} Positionen gepackt` }, bar);
}

/* ===================== Formular-Dialog ===================== */
/**
 * fields: [{ name, label, type: text|textarea|select|checkbox|money|number|date|password,
 *            options: [[value,label],...], required, hint, full, placeholder }]
 * onSubmit(values) darf Fehler werfen -> werden im Dialog angezeigt.
 */
function formDialog({ title, fields, values = {}, submitLabel = 'Speichern', onSubmit }) {
  const dlg = h('dialog', { class: 'dlg' });
  const err = h('div', { class: 'form-error', hidden: true });
  const inputs = {};
  const grid = h('div', { class: 'form-grid' });

  for (const f of fields) {
    const v = values[f.name];
    let input;
    if (f.type === 'select') {
      input = h(
        'select',
        {},
        ...f.options.map(([val, label]) => h('option', { value: val, selected: String(val) === String(v ?? '') }, label)),
      );
    } else if (f.type === 'checkgroup') {
      const have = new Set(Array.isArray(v) ? v : []);
      input = h('div', { class: 'checkgroup' }, ...f.options.map(([val, label]) =>
        h('label', { class: 'check-pill' }, h('input', { type: 'checkbox', value: val, checked: have.has(val) }), h('span', {}, label))));
    } else if (f.type === 'textarea') {
      input = h('textarea', { rows: 3, value: v ?? '' });
    } else if (f.type === 'checkbox') {
      input = h('input', { type: 'checkbox', checked: !!v });
    } else if (f.type === 'money') {
      input = h('input', { type: 'text', inputmode: 'decimal', value: moneyInput(v), placeholder: '0,00' });
    } else {
      input = h('input', {
        type: f.type || 'text',
        value: v ?? '',
        placeholder: f.placeholder,
        required: f.required,
        autocomplete: f.type === 'password' ? 'new-password' : 'off',
        min: f.min,
        max: f.max,
      });
    }
    inputs[f.name] = input;
    const cls = `field${f.type === 'checkgroup' ? ' full' : ''}${f.type === 'checkbox' ? ' checkbox-field' : ''}${f.full ? ' full' : ''}`;
    grid.append(
      f.type === 'checkbox'
        ? h('label', { class: cls }, input, h('span', {}, f.label))
        : f.type === 'checkgroup'
        ? h('div', { class: cls }, h('span', {}, f.label), input, f.hint ? h('span', { class: 'hint' }, f.hint) : null)
        : h('label', { class: cls }, h('span', {}, f.label), input, f.hint ? h('span', { class: 'hint' }, f.hint) : null),
    );
  }

  const saveBtn = h('button', { type: 'submit', class: 'btn primary' }, submitLabel);
  const form = h(
    'form',
    { method: 'dialog' },
    h('h2', {}, title),
    grid,
    err,
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Abbrechen'), saveBtn),
  );

  function collect() {
    const out = {};
    for (const f of fields) {
      const el = inputs[f.name];
      if (f.type === 'checkgroup') out[f.name] = [...el.querySelectorAll('input:checked')].map((i) => i.value);
      else if (f.type === 'checkbox') out[f.name] = el.checked;
      else if (f.type === 'money') out[f.name] = parseMoney(el.value);
      else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
      else if (f.type === 'select') out[f.name] = el.value === '' ? null : el.value;
      else out[f.name] = el.value;
    }
    return out;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    saveBtn.disabled = true;
    try {
      await onSubmit(collect());
      dlg.close();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      saveBtn.disabled = false;
    }
  });

  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  const first = grid.querySelector('input:not([type=checkbox]), select, textarea');
  if (first) first.focus();
}


/* ===================== Unterschrift (Lieferschein) ===================== */
function signatureDialog(order, onSaved) {
  const dlg = h('dialog', { class: 'dlg sig-dlg' });
  const strokes = [];
  let current = null;
  const canvas = h('canvas', { class: 'sig-canvas', width: 900, height: 300, 'aria-label': 'Unterschriftsfeld' });
  const ctx = canvas.getContext('2d');
  const name = h('input', { type: 'text', value: order.signed_name || order.customer_name || '', placeholder: 'Name des Empfängers', autocomplete: 'off' });
  const deliver = h('input', { type: 'checkbox', checked: order.status !== 'geliefert' });
  const err = h('div', { class: 'form-error', hidden: true });
  const hint = h('div', { class: 'sig-hint muted' }, 'Hier unterschreiben');
  const dark = () => document.documentElement.dataset.theme === 'dark';

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    for (const s of strokes) {
      ctx.beginPath();
      s.forEach(([x, y], i) => { const px = x * canvas.width, py = y * canvas.height; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      if (s.length === 1) ctx.lineTo(s[0][0] * canvas.width + 0.1, s[0][1] * canvas.height);
      ctx.stroke();
    }
    hint.hidden = strokes.length > 0;
  }
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); err.hidden = true; canvas.setPointerCapture(e.pointerId); current = [pos(e)]; strokes.push(current); redraw(); });
  canvas.addEventListener('pointermove', (e) => { if (!current) return; current.push(pos(e)); redraw(); });
  const end = () => { current = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const save = h('button', { type: 'button', class: 'btn primary', id: 'sig-save', onclick: async () => {
    err.hidden = true;
    if (!strokes.length) { err.textContent = 'Bitte zuerst unterschreiben.'; err.hidden = false; return; }
    if (!name.value.trim()) { err.textContent = 'Bitte den Namen des Empfängers eintragen.'; err.hidden = false; return; }
    save.disabled = true;
    try {
      const res = await api(`/driver/orders/${order.id}/signature`, { method: 'POST', body: { name: name.value.trim(), strokes, mark_delivered: deliver.checked } });
      dlg.close();
      toast('Unterschrift gespeichert.');
      onSaved(res);
    } catch (e) { err.textContent = e.message; err.hidden = false; } finally { save.disabled = false; }
  } }, 'Speichern');

  dlg.append(h('div', { class: 'sig-body' },
    h('h2', {}, `Lieferschein ${order.number}`),
    h('div', { class: 'muted' }, `${order.customer_name} · ${order.items ? order.items.length : order.item_count} Positionen`),
    h('div', { class: 'sig-wrap' }, canvas, hint),
    h('label', { class: 'field' }, h('span', {}, 'Name des Empfängers'), name),
    order.status !== 'geliefert' ? h('label', { class: 'field checkbox-field' }, deliver, h('span', {}, 'Auftrag als geliefert markieren')) : null,
    err,
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => { strokes.length = 0; redraw(); } }, 'Löschen'),
      h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Abbrechen'),
      save)));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  redraw();
}
