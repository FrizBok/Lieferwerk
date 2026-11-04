'use strict';

/* ===================== Navigation je Rolle ===================== */
const NAV_ADMIN = [
  { items: [['/', 'Übersicht', 'home'], ['/orders', 'Aufträge', 'orders'], ['/plan', 'Tagesplanung', 'calendar'], ['/pack', 'Packlisten', 'pack'], ['/driver', 'Touren', 'route'],
    ['/fleet', 'Fuhrpark', 'truck'], ['/customers', 'Kunden', 'users'], ['/archive', 'Archiv', 'archive'], ['/reports', 'Auswertung', 'chart']] },
  { title: 'Verwaltung', items: [['/products', 'Produkte', 'tag'], ['/deposit', 'Pfand', 'refresh'], ['/users', 'Team', 'users'], ['/settings', 'Einstellungen', 'settings']] },
];
/** Menü nach Rollen: Admin sieht alles, sonst die Punkte der jeweiligen Rollen (auch kombiniert). */
function navGroups() {
  if (hasRole('admin')) return NAV_ADMIN;
  const items = [];
  if (hasRole('packer')) items.push(['/pack', 'Packlisten', 'pack']);
  if (hasRole('driver')) items.push(['/driver', 'Meine Touren', 'route']);
  items.push(['/settings', 'Konto', 'user']);
  return [{ items }];
}
function homePath() {
  return hasRole('admin') ? '/' : hasRole('packer') ? '/pack' : '/driver';
}

let mainEl = null;
let navLinks = [];
let shellEl = null;
let renderToken = 0;

/* ===================== Anmeldung ===================== */
function showLogin(message) {
  clearInterval(state.timer);
  mainEl = null;
  const err = h('div', { class: 'form-error', hidden: !message }, message || '');
  const user = h('input', { type: 'text', autocomplete: 'username', required: true, autofocus: true });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Anmelden');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    btn.disabled = true;
    try {
      await api('/login', { method: 'POST', body: { username: user.value, password: pass.value } });
      await startSession();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      pass.value = '';
      pass.focus();
    } finally {
      btn.disabled = false;
    }
  } },
    h('label', { class: 'field' }, h('span', {}, 'Benutzername'), user),
    h('label', { class: 'field' }, h('span', {}, 'Passwort'), pass),
    err, btn);
  authScreen('Anmelden', 'Schön, dass du da bist.', form);
}

function authScreen(title, subtitle, form) {
  $app.replaceChildren(h('div', { class: 'login-wrap' },
    h('div', { class: 'login-hero' },
      h('div', { class: 'hero-logo' }, h('img', { src: '/favicon.svg', alt: '' }), 'Lieferwerk'),
      h('h2', {}, 'Aufträge, Packlisten, Pfand und Fuhrpark an einem Ort.'),
      h('ul', {}, h('li', {}, 'Packlisten am Handy abhaken'), h('li', {}, 'Pfand je Kasten oder Flasche'), h('li', {}, 'Fahrzeuge und Anhänger im Blick'))),
    h('div', { class: 'login-panel' }, h('div', { class: 'login-card' }, h('h1', {}, title), h('div', { class: 'muted' }, subtitle), form))));
}

function showSetup() {
  clearInterval(state.timer);
  mainEl = null;
  const err = h('div', { class: 'form-error', hidden: true });
  const name = h('input', { type: 'text', autocomplete: 'name', required: true, placeholder: 'z. B. Max Mustermann' });
  const user = h('input', { type: 'text', autocomplete: 'username', required: true, placeholder: 'z. B. max' });
  const pass = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const pass2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const btn = h('button', { class: 'btn primary big', type: 'submit' }, 'Benutzer anlegen');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (pass.value !== pass2.value) { err.textContent = 'Die Passwörter stimmen nicht überein.'; err.hidden = false; return; }
    btn.disabled = true;
    try {
      await api('/setup', { method: 'POST', body: { name: name.value, username: user.value, password: pass.value } });
      await startSession();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { btn.disabled = false; }
  } },
    h('label', { class: 'field' }, h('span', {}, 'Dein Name'), name),
    h('label', { class: 'field' }, h('span', {}, 'Benutzername'), user),
    h('label', { class: 'field' }, h('span', {}, 'Passwort (mind. 8 Zeichen)'), pass),
    h('label', { class: 'field' }, h('span', {}, 'Passwort wiederholen'), pass2),
    err, btn);
  authScreen('Willkommen!', 'Lege den ersten Benutzer an. Er wird Administrator und kann danach Packer und Fahrer hinzufügen.', form);
  name.focus();
}

async function startSession() {
  const me = await api('/me');
  state.user = me.user;
  state.canSeeDeposit = me.can_see_deposit;
  applyDepositForRoute(location.hash.slice(1).split('?')[0]);
  buildShell();
  if (!location.hash || location.hash === '#/' || !location.hash.startsWith('#/')) location.hash = `#${homePath()}`;
  route();
}

/** Pfand-Sichtbarkeit: Admin immer; Packer entscheiden selbst (Standard aus) in der Packliste; als Fahrer immer sichtbar. */
function applyDepositForRoute(path) {
  const packContext = /^\/pack(\/|$)/.test(path || '');
  if (hasRole('admin') || !hasRole('packer') || (hasRole('driver') && !packContext)) state.showDeposit = true;
  else state.showDeposit = localStorage.getItem('lw_show_deposit_packer') === '1';
  applyDepositVisibility();
}

async function logout() {
  try { await api('/logout', { method: 'POST', body: {} }); } catch { /* egal */ }
  state.user = null;
  location.hash = '';
  showLogin();
}

/* ===================== Grundgerüst ===================== */
function buildShell() {
  navLinks = [];
  const groups = navGroups().map((g) => h('div', {},
    g.title ? h('div', { class: 'sb-title' }, g.title) : null,
    ...g.items.map(([path, label, ic]) => {
      const a = h('a', { class: 'sb-link', href: `#${path}`, 'data-path': path, title: label }, icon(ic), h('span', { class: 'sb-label' }, label));
      navLinks.push(a);
      return a;
    })));

  const themeLabel = h('span', { class: 'sb-label' });
  const themeIcon = h('span', { style: 'display:contents' });
  const themeBtn = h('button', { class: 'sb-btn', type: 'button', id: 'theme-toggle' }, themeIcon, themeLabel);
  const paintTheme = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    themeIcon.replaceChildren(icon(dark ? 'sun' : 'moon'));
    themeLabel.textContent = dark ? 'Heller Modus' : 'Dunkler Modus';
    themeBtn.title = themeLabel.textContent;
    themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  };
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    storeSet('lw_theme', next);
    applyTheme(next);
    paintTheme();
  });
  paintTheme();

  const collapseLabel = h('span', { class: 'sb-label' }, 'Menü einklappen');
  const collapseBtn = h('button', { class: 'sb-btn collapse-btn', type: 'button', id: 'sidebar-toggle', 'aria-expanded': 'true' }, icon('chevrons'), collapseLabel);
  const paintCollapse = () => {
    const c = shellEl.classList.contains('collapsed');
    collapseLabel.textContent = c ? 'Menü ausklappen' : 'Menü einklappen';
    collapseBtn.title = collapseLabel.textContent;
    collapseBtn.setAttribute('aria-expanded', c ? 'false' : 'true');
  };
  collapseBtn.addEventListener('click', () => {
    shellEl.classList.toggle('collapsed');
    storeSet('lw_sidebar', shellEl.classList.contains('collapsed') ? '1' : '0');
    paintCollapse();
  });

  const closeDrawer = () => shellEl.classList.remove('open');
  mainEl = h('main', { class: 'page' });
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Hauptmenü' },
    h('a', { class: 'brand', href: `#${homePath()}` }, h('img', { src: '/favicon.svg', alt: '' }), h('span', { class: 'brand-name' }, 'Lieferwerk')),
    h('nav', { class: 'sb-nav' }, ...groups),
    h('div', { class: 'sb-spacer' }),
    h('div', { class: 'sb-foot' },
      h('div', { class: 'sb-user' }, h('b', {}, state.user.name), roleText(state.user.roles)),
      themeBtn, collapseBtn,
      h('button', { class: 'sb-btn', type: 'button', title: 'Abmelden', onclick: logout }, icon('logout'), h('span', { class: 'sb-label' }, 'Abmelden'))));

  shellEl = h('div', { class: 'shell' + (storeGet('lw_sidebar') === '1' ? ' collapsed' : '') },
    sidebar,
    h('div', { class: 'scrim', onclick: closeDrawer }),
    h('div', { class: 'content' },
      h('div', { class: 'mobilebar' },
        h('button', { class: 'sb-btn', type: 'button', id: 'menu-open', 'aria-label': 'Menü öffnen', onclick: () => shellEl.classList.add('open') }, icon('menu')),
        h('img', { src: '/favicon.svg', alt: '' }), 'Lieferwerk'),
      mainEl));
  paintCollapse();
  $app.replaceChildren(shellEl);
}

function markNav(navPath) {
  for (const a of navLinks) {
    const on = a.getAttribute('data-path') === navPath;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (shellEl) shellEl.classList.remove('open');
}

/* ===================== Router ===================== */
function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(qs || '') };
}

async function route() {
  clearInterval(state.timer);
  state.timer = null;
  if (!state.user) return;
  if (!mainEl) buildShell();
  const { path, query } = parseHash();
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    if (!r.roles.some(hasRole)) break;
    const token = ++renderToken;
    applyDepositForRoute(path);
    markNav(r.nav);
    mainEl.replaceChildren(h('p', { class: 'muted' }, 'Lade …'));
    try {
      const node = await r.page(m, query);
      if (token !== renderToken) { clearInterval(state.timer); state.timer = null; return; }
      mainEl.replaceChildren(node);
      window.scrollTo(0, 0);
    } catch (e) {
      if (token !== renderToken) return;
      mainEl.replaceChildren(errorBox(e));
    }
    return;
  }
  location.replace(`#${homePath()}`);
}

window.addEventListener('hashchange', route);

/* ===================== Start ===================== */
(async function boot() {
  try {
    await startSession();
  } catch {
    try {
      const st = await api('/setup-status');
      if (st.needs_setup) showSetup();
      else showLogin();
    } catch {
      showLogin();
    }
  }
})();

// Aufklappmenüs (z. B. Fuhrpark "Mehr") bei Klick daneben schließen
document.addEventListener('click', (e) => {
  for (const d of document.querySelectorAll('details.more[open]')) if (!d.contains(e.target)) d.open = false;
});
