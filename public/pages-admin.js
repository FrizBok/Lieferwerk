'use strict';

/* ===================== Übersicht ===================== */
function miniOrder(o) {
  const team = [o.driver_name, o.vehicle_plate, o.trailer_plate].filter(Boolean).join(' · ');
  return h(
    'a',
    { class: 'mini-order', href: `#/orders/${o.id}` },
    h(
      'div',
      { class: 'grow' },
      h('strong', {}, `${o.number} `),
      o.customer_name,
      h('div', { class: 'muted small' }, [o.city, o.time_window, team].filter(Boolean).join(' · ')),
    ),
    statusBadge(o.status),
  );
}

ROUTES.push({
  re: /^\/$/,
  roles: ['admin'],
  nav: '/',
  page: async () => {
    const d = await api('/dashboard');
    const stat = (n, label, href) =>
      h('a', { class: 'stat', href }, h('div', { class: 'stat-n' }, n), h('div', { class: 'stat-l' }, label));
    const list = (orders, empty) =>
      orders.length ? h('div', { class: 'stack' }, ...orders.map(miniOrder)) : h('div', { class: 'empty' }, empty);
    return h(
      'div',
      {},
      pageHead('Übersicht', h('a', { class: 'btn primary', href: '#/orders/new' }, '+ Neuer Auftrag')),
      h(
        'div',
        { class: 'grid stats' },
        stat(d.counts.today, 'Lieferungen heute', `#/orders?date=${d.today}`),
        stat(d.counts.neu, 'Neu, noch nicht gepackt', '#/orders?status=neu'),
        stat(d.counts.packen, 'Werden gepackt', '#/orders?status=packen'),
        stat(d.counts.gepackt, 'Gepackt, bereit zur Abfahrt', '#/orders?status=gepackt'),
        stat(d.counts.unterwegs, 'Unterwegs', '#/orders?status=unterwegs'),
        stat(d.counts.upcoming_7_days, 'Offen in den nächsten 7 Tagen', '#/orders?status=offen'),
      ),
      h(
        'div',
        { class: 'grid cols-2 mt' },
        h('div', { class: 'card' }, h('h2', {}, `Heute (${fmtDate(d.today)})`), list(d.today_orders, 'Heute sind keine Lieferungen geplant.')),
        h(
          'div',
          { class: 'card' },
          h('h2', {}, 'Jetzt unterwegs'),
          list(d.on_route, 'Gerade ist niemand unterwegs.'),
          h(
            'p',
            { class: 'muted small mt' },
            `Fahrzeuge unterwegs: ${d.fleet.vehicles_on_route} von ${d.fleet.vehicles_total} · `,
            `Anhänger unterwegs: ${d.fleet.trailers_on_route} von ${d.fleet.trailers_total} · `,
            `In der Werkstatt: ${d.fleet.in_workshop} · `,
            h('a', { href: '#/fleet' }, 'Zum Fuhrpark'),
          ),
        ),
      ),
    );
  },
});

/* ===================== Aufträge: Liste ===================== */
ROUTES.push({
  re: /^\/orders$/,
  roles: ['admin'],
  nav: '/orders',
  page: async (_m, q) => {
    const filters = {
      status: q.has('status') ? q.get('status') : q.has('date') ? '' : 'offen',
      date: q.get('date') || '',
      q: '',
    };
    const tbody = h('tbody');
    const info = h('div', { class: 'muted small' });
    const wrap = h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, 'Nr.'),
            h('th', {}, 'Kunde'),
            h('th', {}, 'Ort'),
            h('th', {}, 'Lieferung'),
            h('th', {}, 'Status'),
            h('th', {}, 'Gepackt'),
            h('th', {}, 'Packer / Fahrer'),
            h('th', {}, 'Fahrzeug / Anhänger'),
            h('th', { class: 'num dep' }, 'Pfand'),
          ),
        ),
        tbody,
      ),
    );

    async function load() {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.date) params.set('date', filters.date);
      if (filters.q) params.set('q', filters.q);
      try {
        const orders = await api(`/orders?${params}`);
        info.textContent = `${orders.length} ${orders.length === 1 ? 'Auftrag' : 'Aufträge'}`;
        tbody.replaceChildren(
          ...(orders.length
            ? orders.map((o) =>
                h(
                  'tr',
                  { class: 'clickable', onclick: () => (location.hash = `#/orders/${o.id}`) },
                  h('td', { class: 'nowrap' }, h('strong', {}, o.number)),
                  h('td', {}, o.customer_name),
                  h('td', {}, o.city || ''),
                  h('td', { class: 'nowrap' }, fmtDate(o.delivery_date) || '–', o.time_window ? h('div', { class: 'muted small' }, o.time_window) : null),
                  h('td', {}, statusBadge(o.status)),
                  h('td', { class: 'nowrap' }, `${o.packed_count}/${o.item_count}`),
                  h('td', {}, [o.packer_name, o.driver_name].filter(Boolean).join(' / ') || '–'),
                  h('td', {}, [o.vehicle_plate, o.trailer_plate].filter(Boolean).join(' + ') || '–'),
                  h('td', { class: 'num dep nowrap' }, eur(o.deposit_total_cents)),
                ),
              )
            : [h('tr', {}, h('td', { colspan: 9, class: 'empty' }, 'Keine Aufträge gefunden.'))]),
        );
      } catch (e) {
        tbody.replaceChildren(h('tr', {}, h('td', { colspan: 9 }, errorBox(e))));
      }
    }

    let timer;
    const statusSel = h(
      'select',
      { onchange: (e) => { filters.status = e.target.value; load(); } },
      ...[['', 'Alle Status'], ['offen', 'Offen (nicht geliefert)'], ...Object.entries(STATUS_LABELS)].map(([v, l]) =>
        h('option', { value: v, selected: v === filters.status }, l),
      ),
    );
    const dateInput = h('input', { type: 'date', value: filters.date, onchange: (e) => { filters.date = e.target.value; load(); } });
    const search = h('input', {
      type: 'search',
      placeholder: 'Suche: Kunde, Nummer, Ort …',
      oninput: (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => { filters.q = e.target.value.trim(); load(); }, 250);
      },
    });
    load();
    return h(
      'div',
      {},
      pageHead('Aufträge', info, h('a', { class: 'btn primary', href: '#/orders/new' }, '+ Neuer Auftrag')),
      h('div', { class: 'filters' }, statusSel, dateInput, search),
      wrap,
    );
  },
});

/* ===================== Aufträge: Anlegen / Bearbeiten ===================== */
function newOrderDraft() {
  return {
    customer_id: null, customer_name: '', address: '', postal_code: '', city: '', phone: '', delivery_date: '', time_window: '',
    notes: '', packer_id: null, driver_id: null, vehicle_id: null, trailer_id: null, status: 'neu', items: [],
  };
}

ROUTES.push({
  re: /^\/orders\/(new|\d+)$/,
  roles: ['admin'],
  nav: '/orders',
  page: async (m, q) => orderForm(m[1] === 'new' ? null : Number(m[1]), q),
});

async function orderForm(id, q = new URLSearchParams()) {
  const [lk, existing] = await Promise.all([api('/lookups'), id ? api(`/orders/${id}`) : Promise.resolve(null)]);
  const o = existing ? JSON.parse(JSON.stringify(existing)) : newOrderDraft();
  if (!existing && q.get('customer_id')) {
    const c = lk.customers.find((x) => x.id === Number(q.get('customer_id')));
    if (c) Object.assign(o, { customer_id: c.id, customer_name: c.name, address: c.address || '', postal_code: c.postal_code || '', city: c.city || '', phone: c.phone || '' });
  }
  // Kunde: bestehenden wählen oder neu anlegen
  let custMode = o.customer_id || (lk.customers.length && !existing) ? 'existing' : existing ? 'new' : 'new';
  if (!o.customer_id && !existing && lk.customers.length) custMode = 'existing';
  const inputs = {};
  const rules = new Map(lk.deposit_rules.map((r) => [r.id, r]));

  /* ---- Stammdaten-Felder ---- */
  const text = (label, key, opts = {}) => {
    const input = h('input', {
      type: opts.type || 'text',
      value: o[key] ?? '',
      placeholder: opts.placeholder,
      autocomplete: 'off',
      list: opts.list,
      oninput: (e) => { o[key] = e.target.value; },
      onchange: opts.onchange,
    });
    inputs[key] = input;
    return h('label', { class: `field ${opts.cls || ''}` }, h('span', {}, label), input, opts.extra);
  };
  const fillFields = (c) => {
    o.customer_name = c ? c.name : '';
    for (const k of ['address', 'postal_code', 'city', 'phone']) {
      o[k] = c ? (c[k] || '') : '';
      if (inputs[k]) inputs[k].value = o[k];
    }
    if (inputs.customer_name) inputs.customer_name.value = o.customer_name;
  };
  const custLabel = (c) => `${c.name}${[c.address, c.city].filter(Boolean).length ? ' – ' + [c.address, c.city].filter(Boolean).join(', ') : ''}`;
  const custSelect = h('select', { id: 'customer-select', onchange: (e) => {
    const c = lk.customers.find((x) => x.id === Number(e.target.value));
    if (!c) { o.customer_id = null; fillFields(null); paintCustomer(); return; }
    o.customer_id = c.id;
    fillFields(c);
    paintCustomer();
  } });
  const custFilter = h('input', { type: 'search', placeholder: 'Kunden suchen …', autocomplete: 'off', oninput: () => fillCustOptions() });
  function fillCustOptions() {
    const f = custFilter.value.trim().toLowerCase();
    const list = lk.customers.filter((c) => c.id === o.customer_id || !f || custLabel(c).toLowerCase().includes(f));
    custSelect.replaceChildren(
      h('option', { value: '' }, list.length ? '– Kunde auswählen –' : 'Kein Treffer'),
      ...list.map((c) => h('option', { value: c.id, selected: c.id === o.customer_id }, custLabel(c))));
  }
  const custInfo = h('div', { class: 'muted small' });
  const existingBox = h('div', { class: 'full cust-box' },
    h('label', { class: 'field' }, h('span', {}, 'Kunde auswählen *'), custFilter, custSelect), custInfo);
  const modeBtns = {};
  const setMode = (m) => {
    if (m === custMode) return;
    custMode = m;
    if (m === 'new') { o.customer_id = null; fillFields(null); } else { custFilter.value = ''; fillCustOptions(); }
    paintCustomer();
  };
  const modeSeg = h('div', { class: 'seg full', role: 'group', 'aria-label': 'Kunde' },
    modeBtns.existing = h('button', { type: 'button', id: 'mode-existing', onclick: () => setMode('existing') }, 'Bestehender Kunde'),
    modeBtns.new = h('button', { type: 'button', id: 'mode-new', onclick: () => setMode('new') }, '+ Neuer Kunde'));
  let nameField;
  function paintCustomer() {
    for (const [k, b] of Object.entries(modeBtns)) b.setAttribute('aria-pressed', k === custMode ? 'true' : 'false');
    existingBox.hidden = custMode !== 'existing';
    if (nameField) nameField.hidden = custMode !== 'new';
    const c = lk.customers.find((x) => x.id === o.customer_id);
    custInfo.replaceChildren(...(custMode === 'existing' && c ? ['Lieferadresse unten kann für diesen Auftrag abweichen. ', h('a', { href: `#/customers/${c.id}` }, 'Kunde öffnen')] : []));
    if (custMode === 'new') custInfo.textContent = '';
  }

  const select = (label, key, options) =>
    h(
      'label',
      { class: 'field' },
      h('span', {}, label),
      h(
        'select',
        { onchange: (e) => { o[key] = e.target.value ? Number(e.target.value) : null; } },
        h('option', { value: '' }, '– nicht zugewiesen –'),
        ...options.map((x) => h('option', { value: x.id, selected: o[key] === x.id }, x.label)),
      ),
    );

  /* ---- Positionen ---- */
  function itemDeposit(it) {
    if (it.deposit_override_cents !== null && it.deposit_override_cents !== undefined) return it.deposit_override_cents;
    const rule = it.deposit_rule_id ? rules.get(it.deposit_rule_id) : null;
    if (!rule) return 0;
    const per = it.packaging === 'kasten' ? rule.crate_cents + rule.bottles_per_crate * rule.bottle_cents : rule.bottle_cents;
    return Math.round((Number(it.quantity) || 0) * per);
  }

  const tbody = h('tbody');
  const totalDeposit = h('td', { class: 'num dep nowrap' });
  const totalCount = h('td', { colspan: 2 });
  const tabCount = h('span', { class: 'tab-count' }, '0');
  function updateTotals() {
    tabCount.textContent = String(o.items.length);
    totalCount.textContent = `${o.items.length} Position${o.items.length === 1 ? '' : 'en'}`;
    totalDeposit.textContent = eur(o.items.reduce((s, it) => s + itemDeposit(it), 0));
  }

  function itemRow(it) {
    const depCell = h('td', { class: 'num dep nowrap' });
    const refresh = () => { depCell.textContent = eur(itemDeposit(it)); updateTotals(); };
    const row = h(
      'tr',
      {},
      h('td', {}, h('input', { type: 'text', class: 'w-name', value: it.name, 'aria-label': 'Produkt', oninput: (e) => { it.name = e.target.value; } })),
      h('td', {}, h('input', {
        type: 'text', inputmode: 'decimal', class: 'w-qty', value: fmtQty(it.quantity), 'aria-label': 'Menge',
        oninput: (e) => { it.quantity = parseNum(e.target.value); refresh(); },
      })),
      h('td', {}, h('input', { type: 'text', class: 'w-unit', value: it.unit || 'Stk', 'aria-label': 'Einheit', oninput: (e) => { it.unit = e.target.value; } })),
      h(
        'td',
        {},
        h(
          'select',
          { class: 'w-pack', 'aria-label': 'Verpackung', onchange: (e) => { it.packaging = e.target.value; refresh(); } },
          h('option', { value: 'einzeln', selected: it.packaging === 'einzeln' }, 'einzeln'),
          h('option', { value: 'kasten', selected: it.packaging === 'kasten' }, 'Kasten'),
        ),
      ),
      h(
        'td',
        { class: 'dep' },
        h(
          'select',
          { class: 'w-rule', 'aria-label': 'Pfandregel', onchange: (e) => { it.deposit_rule_id = e.target.value ? Number(e.target.value) : null; refresh(); } },
          h('option', { value: '' }, '– kein Pfand –'),
          ...lk.deposit_rules.map((r) => h('option', { value: r.id, selected: it.deposit_rule_id === r.id }, r.name)),
        ),
      ),
      h('td', { class: 'dep' }, h('input', {
        type: 'text', inputmode: 'decimal', class: 'w-money', placeholder: 'automatisch', 'aria-label': 'Pfand manuell',
        value: moneyInput(it.deposit_override_cents),
        oninput: (e) => {
          try { it.deposit_override_cents = parseMoney(e.target.value); e.target.removeAttribute('aria-invalid'); }
          catch { it.deposit_override_cents = null; e.target.setAttribute('aria-invalid', 'true'); }
          refresh();
        },
      })),
      depCell,
      h('td', {}, h('input', { type: 'text', value: it.note || '', placeholder: 'Notiz', 'aria-label': 'Notiz', oninput: (e) => { it.note = e.target.value; } })),
      h('td', {}, h('button', {
        type: 'button', class: 'btn small icon danger', title: 'Position entfernen', 'aria-label': 'Position entfernen',
        onclick: () => { o.items.splice(o.items.indexOf(it), 1); renderRows(); },
      }, '✕')),
    );
    depCell.textContent = eur(itemDeposit(it));
    return row;
  }

  function renderRows(focusLast = false) {
    tbody.replaceChildren(
      ...(o.items.length
        ? o.items.map(itemRow)
        : [h('tr', {}, h('td', { colspan: 9, class: 'empty' }, 'Noch keine Positionen. Unten Produkte hinzufügen.'))]),
    );
    updateTotals();
    if (focusLast) {
      const input = tbody.lastElementChild && tbody.lastElementChild.querySelector('.w-qty');
      if (input) { input.focus(); input.select(); }
    }
  }

  function addItem(item) {
    o.items.push({ id: null, product_id: null, name: '', quantity: 1, unit: 'Stk', packaging: 'einzeln', deposit_rule_id: null, deposit_override_cents: null, note: '', ...item });
    renderRows(true);
  }

  const byCategory = new Map();
  for (const p of lk.products) {
    const c = p.category || 'Ohne Kategorie';
    if (!byCategory.has(c)) byCategory.set(c, []);
    byCategory.get(c).push(p);
  }
  const productSelect = h(
    'select',
    {
      'aria-label': 'Produkt aus Liste hinzufügen',
      onchange: (e) => {
        const p = lk.products.find((x) => x.id === Number(e.target.value));
        if (p) addItem({ product_id: p.id, name: p.name, unit: p.unit, packaging: p.default_packaging, deposit_rule_id: p.deposit_rule_id });
        e.target.value = '';
      },
    },
    h('option', { value: '' }, '+ Produkt aus Liste hinzufügen …'),
    ...[...byCategory.entries()].map(([cat, list]) =>
      h('optgroup', { label: cat }, ...list.map((p) => h('option', { value: p.id }, p.name))),
    ),
  );
  const manualInput = h('input', {
    type: 'text', placeholder: 'Oder manuell: Produktname eingeben', 'aria-label': 'Manuelle Position',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } },
  });
  function addManual() {
    const name = manualInput.value.trim();
    if (!name) { manualInput.focus(); return; }
    addItem({ name });
    manualInput.value = '';
  }

  const itemsCard = h(
    'div',
    { class: 'card', role: 'tabpanel', id: 'pane-positionen', hidden: true },
    h('h2', {}, 'Positionen'),
    h('div', { class: 'info-box dep' }, 'Pfand: je Position Verpackung (einzeln oder Kasten) und Pfandregel wählen. Abweichende Beträge können manuell eingetragen werden und überschreiben die Regel.'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'items-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Produkt'), h('th', {}, 'Menge'), h('th', {}, 'Einheit'), h('th', {}, 'Verpackung'),
          h('th', { class: 'dep' }, 'Pfandregel'), h('th', { class: 'dep' }, 'Pfand manuell'),
          h('th', { class: 'num dep' }, 'Pfand'), h('th', {}, 'Notiz'), h('th', {}),
        )),
        tbody,
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 6, class: 'right muted' }, ''), totalDeposit, totalCount)),
      ),
    ),
    h('div', { class: 'add-row' }, productSelect, manualInput, h('button', { type: 'button', class: 'btn', onclick: addManual }, '+ Manuell')),
  );

  /* ---- Speichern ---- */
  const saveBtn = h('button', { type: 'button', class: 'btn primary' }, id ? 'Änderungen speichern' : 'Auftrag anlegen');
  saveBtn.addEventListener('click', async () => {
    if (custMode === 'existing' && !o.customer_id) { setTab('kunde'); toast('Bitte einen Kunden auswählen oder „Neuer Kunde“ wählen.', 'error'); return; }
    if (!o.customer_name.trim()) { setTab('kunde'); toast('Bitte einen Kundennamen eintragen.', 'error'); return; }
    for (const it of o.items) {
      if (!it.name.trim()) { setTab('positionen'); toast('Eine Position hat keinen Namen.', 'error'); return; }
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) { setTab('positionen'); toast(`Ungültige Menge bei "${it.name}".`, 'error'); return; }
    }
    const payload = {
      customer_id: custMode === 'existing' ? o.customer_id : null,
      customer_name: o.customer_name, address: o.address, postal_code: o.postal_code, city: o.city, phone: o.phone,
      delivery_date: o.delivery_date, time_window: o.time_window, notes: o.notes,
      packer_id: o.packer_id, driver_id: o.driver_id, vehicle_id: o.vehicle_id, trailer_id: o.trailer_id,
      items: o.items.map((it) => ({
        id: it.id ?? null, product_id: it.product_id ?? null, name: it.name, quantity: it.quantity, unit: it.unit,
        packaging: it.packaging, deposit_rule_id: it.deposit_rule_id ?? null,
        deposit_override_cents: it.deposit_override_cents ?? null, note: it.note || null,
      })),
    };
    saveBtn.disabled = true;
    try {
      const res = id
        ? await api(`/orders/${id}`, { method: 'PUT', body: payload })
        : await api('/orders', { method: 'POST', body: payload });
      toast(id ? 'Gespeichert.' : `Auftrag ${res.order.number} angelegt.`);
      toastWarnings(res.warnings);
      if (id) route();
      else location.hash = `#/orders/${res.order.id}`;
    } catch (e) {
      toast(e.message, 'error', 6000);
    } finally {
      saveBtn.disabled = false;
    }
  });

  /* ---- Aktionen für bestehende Aufträge ---- */
  let actions = null;
  if (id) {
    const statusSel = h('select', { 'aria-label': 'Status' }, ...Object.entries(STATUS_LABELS).map(([v, l]) => h('option', { value: v, selected: v === o.status }, l)));
    actions = h(
      'div',
      { class: 'card mt no-print' },
      h('h2', {}, 'Status & Aktionen'),
      h('div', { class: 'row' },
        statusBadge(o.status),
        statusSel,
        h('button', { type: 'button', class: 'btn', onclick: async () => {
          try { const res = await api(`/orders/${id}/status`, { method: 'POST', body: { status: statusSel.value } }); toast('Status geändert.'); toastWarnings(res.warnings); route(); }
          catch (e) { toast(e.message, 'error'); }
        } }, 'Status setzen'),
        h('div', { class: 'spacer', style: 'flex:1' }),
        h('a', { class: 'btn', href: `#/orders/${id}/print` }, 'Packliste drucken'),
        h('button', { type: 'button', class: 'btn', onclick: async () => {
          try { const res = await api(`/orders/${id}/duplicate`, { method: 'POST', body: {} }); toast(`Kopie ${res.order.number} angelegt.`); location.hash = `#/orders/${res.order.id}`; }
          catch (e) { toast(e.message, 'error'); }
        } }, 'Duplizieren'),
        h('button', { type: 'button', class: 'btn danger', onclick: async () => {
          if (!confirm(`Auftrag ${o.number} wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
          try { await api(`/orders/${id}`, { method: 'DELETE' }); toast('Auftrag gelöscht.'); location.hash = '#/orders'; }
          catch (e) { toast(e.message, 'error'); }
        } }, 'Löschen'),
      ),
    );
  }

  const vehicleOpts = lk.vehicles.map((v) => ({ id: v.id, label: `${v.plate}${v.name ? ` (${v.name})` : ''}${v.status === 'werkstatt' ? ' – Werkstatt' : ''}` }));
  const trailerOpts = lk.trailers.map((t) => ({ id: t.id, label: `${t.plate}${t.name ? ` (${t.name})` : ''}${t.status === 'werkstatt' ? ' – Werkstatt' : ''}` }));

  // Reiter: Kunde & Lieferung | Zuweisung | Positionen
  let paneKunde, paneZuw;
  const startTab = 'kunde';
  const TABS = [['kunde', 'Kunde & Lieferung'], ['zuweisung', 'Zuweisung'], ['positionen', 'Positionen']];
  const tabBtns = {};
  const tabbar = h('div', { class: 'tabbar', role: 'tablist' }, ...TABS.map(([key, label]) => {
    const b = h('button', { type: 'button', role: 'tab', id: `tab-${key}`, 'aria-controls': `pane-${key}`, onclick: () => setTab(key) },
      label, key === 'positionen' ? tabCount : null);
    tabBtns[key] = b;
    return b;
  }));
  function setTab(key) {
    const panes = { kunde: paneKunde, zuweisung: paneZuw, positionen: itemsCard };
    for (const [k, p] of Object.entries(panes)) {
      if (!p) continue;
      p.hidden = k !== key;
      tabBtns[k].setAttribute('aria-selected', k === key ? 'true' : 'false');
      tabBtns[k].tabIndex = k === key ? 0 : -1;
    }
  }
  tabbar.addEventListener('keydown', (e) => {
    const keys = TABS.map(([k]) => k);
    const cur = keys.findIndex((k) => tabBtns[k].getAttribute('aria-selected') === 'true');
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const nk = keys[(cur + d + keys.length) % keys.length];
    setTab(nk); tabBtns[nk].focus();
  });

  const page = h(
    'div',
    {},
    pageHead(
      id ? `Auftrag ${o.number}` : 'Neuer Auftrag',
      id ? statusBadge(o.status) : null,
      h('a', { class: 'btn', href: '#/orders' }, 'Zur Liste'),
      saveBtn,
    ),
    tabbar,
    paneKunde = h('div', { class: 'card', role: 'tabpanel', id: 'pane-kunde' },
      h('h2', {}, 'Kunde & Lieferung'),
      h('div', { class: 'form-grid' },
        modeSeg,
        existingBox,
        nameField = text('Name / Firma des neuen Kunden *', 'customer_name', { cls: 'full' }),
        text('Straße & Hausnummer', 'address', { cls: 'full' }),
        text('PLZ', 'postal_code'),
        text('Ort', 'city'),
        text('Telefon', 'phone'),
        text('Lieferdatum', 'delivery_date', { type: 'date' }),
        text('Zeitfenster', 'time_window', { placeholder: 'z. B. 14–16 Uhr' }),
        h('label', { class: 'field full' }, h('span', {}, 'Notizen (z. B. Klingel, Etage, Hinweise)'),
          h('textarea', { rows: 2, value: o.notes ?? '', oninput: (e) => { o.notes = e.target.value; } })),
      ),
    ),
    paneZuw = h('div', { class: 'card', role: 'tabpanel', id: 'pane-zuweisung', hidden: true },
      h('h2', {}, 'Zuweisung'),
      h('div', { class: 'form-grid' },
        select('Packer', 'packer_id', lk.packers.map((p) => ({ id: p.id, label: p.name }))),
        select('Fahrer', 'driver_id', lk.drivers.map((p) => ({ id: p.id, label: p.name }))),
        select('Fahrzeug', 'vehicle_id', vehicleOpts),
        select('Anhänger', 'trailer_id', trailerOpts),
      ),
    ),
    itemsCard,
    actions,
  );
  setTab(startTab);
  fillCustOptions();
  paintCustomer();
  renderRows();
  return page;
}

/* ===================== Packliste drucken ===================== */
ROUTES.push({
  re: /^\/orders\/(\d+)\/print$/,
  roles: ['admin', 'packer'],
  nav: '/orders',
  page: async (m) => {
    const id = Number(m[1]);
    const o = await api(hasRole('admin') ? `/orders/${id}` : `/pack/orders/${id}`);
    const withDeposit = o.items.length > 0 && o.items[0].deposit_cents !== undefined;
    return h('div', {},
      h('div', { class: 'page-head no-print' }, h('h1', {}, 'Packliste'), h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => history.back() }, 'Zurück'),
        h('button', { class: 'btn primary', onclick: () => window.print() }, 'Drucken')),
      h('div', { class: 'print-sheet' },
        h('h1', {}, `Packliste ${o.number}`),
        h('div', { class: 'print-meta' },
          h('div', {}, h('strong', {}, 'Kunde: '), o.customer_name),
          h('div', {}, h('strong', {}, 'Lieferung: '), [fmtDate(o.delivery_date), o.time_window].filter(Boolean).join(', ') || '–'),
          h('div', {}, h('strong', {}, 'Adresse: '), addressLine(o) || '–'),
          h('div', {}, h('strong', {}, 'Packer: '), o.packer_name || '–'),
        ),
        o.notes ? h('p', {}, h('strong', {}, 'Hinweis: '), o.notes) : null,
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, 'Menge'), h('th', {}, 'Artikel'), h('th', {}, 'Verpackung'), h('th', {}, 'Notiz'),
            withDeposit ? h('th', { class: 'num dep' }, 'Pfand') : null)),
          h('tbody', {}, ...o.items.map((it) => h('tr', {},
            h('td', {}, h('span', { class: 'box' })),
            h('td', { class: 'num nowrap' }, `${fmtQty(it.quantity)} ${it.unit}`),
            h('td', {}, it.name),
            h('td', {}, it.packaging === 'kasten' ? 'Kasten' : 'einzeln'),
            h('td', {}, it.note || ''),
            withDeposit ? h('td', { class: 'num dep nowrap' }, eur(it.deposit_cents)) : null,
          ))),
        ),
        withDeposit ? h('p', { class: 'dep right' }, h('strong', {}, `Pfand gesamt: ${eur(o.deposit_total_cents)}`)) : null,
      ),
    );
  },
});

/* ===================== Produkte ===================== */
ROUTES.push({
  re: /^\/products$/,
  roles: ['admin'],
  nav: '/products',
  page: async () => {
    const [products, rules] = await Promise.all([api('/products'), api('/deposit-rules')]);
    let filter = '';
    const tbody = h('tbody');
    const ruleOptions = [['', '– kein Pfand –'], ...rules.map((r) => [r.id, r.name])];

    function edit(p) {
      formDialog({
        title: p ? 'Produkt bearbeiten' : 'Neues Produkt',
        values: p || { unit: 'Stk', default_packaging: 'einzeln' },
        fields: [
          { name: 'name', label: 'Produktname *', required: true, full: true },
          { name: 'category', label: 'Kategorie', placeholder: 'z. B. Getränke' },
          { name: 'sku', label: 'Artikelnummer' },
          { name: 'unit', label: 'Einheit', placeholder: 'Stk, kg, l …' },
          { name: 'default_packaging', label: 'Standard-Verpackung', type: 'select', options: [['einzeln', 'einzeln'], ['kasten', 'Kasten']] },
          { name: 'is_beverage', label: 'Ist ein Getränk', type: 'checkbox' },
          { name: 'deposit_rule_id', label: 'Standard-Pfandregel', type: 'select', options: ruleOptions, full: true,
            hint: 'Wird beim Hinzufügen zum Auftrag vorausgewählt und kann dort pro Position geändert werden.' },
        ],
        onSubmit: async (v) => {
          await api(p ? `/products/${p.id}` : '/products', { method: p ? 'PUT' : 'POST', body: v });
          toast('Gespeichert.');
          route();
        },
      });
    }

    function render() {
      const f = filter.toLowerCase();
      const list = products.filter((p) => !f || [p.name, p.category, p.sku].some((x) => (x || '').toLowerCase().includes(f)));
      tbody.replaceChildren(
        ...(list.length
          ? list.map((p) => h('tr', {},
              h('td', {}, h('strong', {}, p.name), p.sku ? h('div', { class: 'muted small' }, p.sku) : null),
              h('td', {}, p.category || ''),
              h('td', {}, p.unit),
              h('td', {}, badge(p.default_packaging, p.default_packaging === 'kasten' ? 'Kasten' : 'einzeln')),
              h('td', { class: 'dep' }, p.deposit_rule_name || '–'),
              h('td', { class: 'right nowrap' },
                h('button', { class: 'btn small', onclick: () => edit(p) }, 'Bearbeiten'), ' ',
                h('button', { class: 'btn small danger', onclick: async () => {
                  if (!confirm(`"${p.name}" löschen? Bestehende Aufträge bleiben unverändert.`)) return;
                  try { await api(`/products/${p.id}`, { method: 'DELETE' }); toast('Gelöscht.'); route(); } catch (e) { toast(e.message, 'error'); }
                } }, 'Löschen')),
            ))
          : [h('tr', {}, h('td', { colspan: 6, class: 'empty' }, 'Keine Produkte gefunden.'))]),
      );
    }
    render();
    return h('div', {},
      pageHead('Produkte', h('button', { class: 'btn primary', onclick: () => edit(null) }, '+ Neues Produkt')),
      h('div', { class: 'info-box' }, 'Hier legst du Produkte vorab fest. Im Auftrag können sie ausgewählt oder zusätzlich manuell eingetragen werden.'),
      h('div', { class: 'filters' }, h('input', { type: 'search', placeholder: 'Produkte suchen …', oninput: (e) => { filter = e.target.value; render(); } })),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Produkt'), h('th', {}, 'Kategorie'), h('th', {}, 'Einheit'), h('th', {}, 'Verpackung'), h('th', { class: 'dep' }, 'Pfandregel'), h('th', {}))),
        tbody)),
    );
  },
});

/* ===================== Pfandregeln ===================== */
ROUTES.push({
  re: /^\/deposit$/,
  roles: ['admin'],
  nav: '/deposit',
  page: async () => {
    const rules = await api('/deposit-rules');

    function edit(r) {
      formDialog({
        title: r ? 'Pfandregel bearbeiten' : 'Neue Pfandregel',
        values: r || { bottles_per_crate: 12 },
        fields: [
          { name: 'name', label: 'Bezeichnung *', required: true, full: true, placeholder: 'z. B. Mehrweg Glas 0,08 € + Kasten 1,50 €' },
          { name: 'bottle_cents', label: 'Pfand je Flasche/Dose (€)', type: 'money', hint: 'Einzelflasche oder Flasche im Kasten' },
          { name: 'crate_cents', label: 'Pfand je Kasten (€)', type: 'money', hint: 'Nur der leere Kasten, ohne Flaschen. 0 bei Einweg.' },
          { name: 'bottles_per_crate', label: 'Flaschen pro Kasten', type: 'number', min: 1, max: 500 },
          { name: 'notes', label: 'Notiz', full: true },
        ],
        onSubmit: async (v) => {
          const body = { ...v, bottle_cents: v.bottle_cents ?? 0, crate_cents: v.crate_cents ?? 0, bottles_per_crate: v.bottles_per_crate ?? 1 };
          await api(r ? `/deposit-rules/${r.id}` : '/deposit-rules', { method: r ? 'PUT' : 'POST', body });
          toast('Gespeichert.');
          route();
        },
      });
    }

    return h('div', {},
      pageHead('Pfandregeln', h('button', { class: 'btn primary', onclick: () => edit(null) }, '+ Neue Pfandregel')),
      h('div', { class: 'info-box' },
        'Eine Pfandregel beschreibt, wie viel Pfand anfällt. Pro Auftragsposition wird gewählt, ob die Ware einzeln oder im Kasten geliefert wird: ',
        h('strong', {}, 'einzeln'), ' = Menge × Flaschenpfand, ', h('strong', {}, 'Kasten'), ' = Menge × (Kastenpfand + Flaschen pro Kasten × Flaschenpfand). ',
        'Die vorbelegten Regeln sind Beispiele – bitte Beträge prüfen und anpassen.'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Bezeichnung'), h('th', { class: 'num' }, 'Je Flasche'), h('th', { class: 'num' }, 'Je Kasten (leer)'), h('th', { class: 'num' }, 'Fl./Kasten'), h('th', { class: 'num' }, 'Kasten voll'), h('th', {}))),
        h('tbody', {}, ...(rules.length ? rules.map((r) => h('tr', {},
          h('td', {}, h('strong', {}, r.name), r.notes ? h('div', { class: 'muted small' }, r.notes) : null),
          h('td', { class: 'num nowrap' }, eur(r.bottle_cents)),
          h('td', { class: 'num nowrap' }, eur(r.crate_cents)),
          h('td', { class: 'num' }, r.bottles_per_crate),
          h('td', { class: 'num nowrap' }, eur(r.crate_cents + r.bottles_per_crate * r.bottle_cents)),
          h('td', { class: 'right nowrap' },
            h('button', { class: 'btn small', onclick: () => edit(r) }, 'Bearbeiten'), ' ',
            h('button', { class: 'btn small danger', onclick: async () => {
              if (!confirm(`Pfandregel "${r.name}" löschen? Bereits berechnete Beträge in Aufträgen bleiben erhalten.`)) return;
              try { await api(`/deposit-rules/${r.id}`, { method: 'DELETE' }); toast('Gelöscht.'); route(); } catch (e) { toast(e.message, 'error'); }
            } }, 'Löschen')),
        )) : [h('tr', {}, h('td', { colspan: 6, class: 'empty' }, 'Noch keine Pfandregeln.'))]))))
    );
  },
});

/* ===================== Fuhrpark ===================== */
const fleetUi = { kind: 'all', state: 'all', q: '', view: (storeGet('lw_fleet_view') === 'list' ? 'list' : 'tiles') };

ROUTES.push({
  re: /^\/fleet$/,
  roles: ['admin'],
  nav: '/fleet',
  page: async () => {
    const fleet = await api('/fleet');
    const all = [
      ...fleet.vehicles.map((x) => ({ ...x, kind: 'vehicles' })),
      ...fleet.trailers.map((x) => ({ ...x, kind: 'trailers' })),
    ];
    const KIND_LABEL = { vehicles: 'Fahrzeug', trailers: 'Anhänger' };
    const typeLabel = (it) => Object.fromEntries(it.kind === 'vehicles' ? VEHICLE_TYPES : TRAILER_TYPES)[it.type] || '';

    function edit(kind, item) {
      const types = kind === 'vehicles' ? VEHICLE_TYPES : TRAILER_TYPES;
      formDialog({
        title: `${kind === 'vehicles' ? 'Fahrzeug' : 'Anhänger'} ${item ? 'bearbeiten' : 'anlegen'}`,
        values: item || {},
        fields: [
          { name: 'plate', label: 'Kennzeichen *', required: true },
          { name: 'name', label: 'Bezeichnung', placeholder: kind === 'vehicles' ? 'z. B. Sprinter weiß' : 'z. B. Kühlanhänger 2' },
          { name: 'type', label: 'Typ', type: 'select', options: types },
          { name: 'status', label: 'Zustand', type: 'select', options: [['verfuegbar', 'Verfügbar'], ['werkstatt', 'In der Werkstatt']] },
          { name: 'capacity', label: 'Ladekapazität', placeholder: 'z. B. 750 kg / 20 Kästen' },
          { name: 'inspection_date', label: 'Nächste HU/TÜV', type: 'date' },
          { name: 'notes', label: 'Notiz', type: 'textarea', full: true },
        ],
        onSubmit: async (v) => {
          await api(item ? `/${kind}/${item.id}` : `/${kind}`, { method: item ? 'PUT' : 'POST', body: v });
          toast('Gespeichert.');
          route();
        },
      });
    }
    async function toggleWorkshop(it) {
      const body = { plate: it.plate, name: it.name, type: it.type, capacity: it.capacity, inspection_date: it.inspection_date, notes: it.notes, status: it.status === 'werkstatt' ? 'verfuegbar' : 'werkstatt' };
      try { await api(`/${it.kind}/${it.id}`, { method: 'PUT', body }); route(); } catch (e) { toast(e.message, 'error'); }
    }
    async function remove(it) {
      if (!confirm(`${it.plate} wirklich löschen?`)) return;
      try { await api(`/${it.kind}/${it.id}`, { method: 'DELETE' }); toast('Gelöscht.'); route(); } catch (e) { toast(e.message, 'error'); }
    }

    const inspectionChip = (it) => {
      if (!it.inspection_date) return null;
      const left = it.inspection_days_left;
      const cls = left < 0 ? 'danger' : left <= 30 ? 'warn' : 'ok';
      const txt = left < 0 ? `HU überfällig (${fmtDate(it.inspection_date)})` : left <= 30 ? `HU in ${left} Tagen` : `HU ${fmtDate(it.inspection_date)}`;
      return h('span', { class: `chip ${cls}`, title: 'Nächste HU/TÜV' }, txt);
    };
    const usage = (it) => {
      if (it.current) return h('span', {}, h('strong', {}, 'Unterwegs: '), h('a', { href: `#/orders/${it.current.id}` }, it.current.customer_name), it.current.driver_name ? ` · ${it.current.driver_name}` : '');
      if (it.state === 'werkstatt') return h('span', { class: 'muted' }, 'In der Werkstatt');
      const u = it.upcoming[0];
      if (u) return h('span', {}, h('strong', {}, 'Nächster Einsatz: '), h('a', { href: `#/orders/${u.id}` }, `${fmtDate(u.delivery_date) || 'ohne Datum'} · ${u.customer_name}`), it.upcoming.length > 1 ? h('span', { class: 'muted' }, ` (+${it.upcoming.length - 1})`) : null);
      return h('span', { class: 'muted' }, 'Kein Einsatz geplant');
    };
    const menu = (it) => h('details', { class: 'more' },
      h('summary', { class: 'btn small', 'aria-label': 'Mehr', title: 'Mehr' }, icon('dots')),
      h('div', { class: 'more-menu' },
        h('button', { type: 'button', onclick: () => toggleWorkshop(it) }, it.status === 'werkstatt' ? 'Wieder verfügbar melden' : 'In die Werkstatt'),
        h('button', { type: 'button', class: 'danger-text', onclick: () => remove(it) }, 'Löschen')));

    function tile(it) {
      return h('div', { class: `card fleet-tile st-${it.state}` },
        h('div', { class: 'ft-top' },
          h('div', { class: 'ft-icon' }, icon(it.kind === 'vehicles' ? 'truck' : 'trailer')),
          h('div', { class: 'ft-title' }, h('div', { class: 'ft-plate' }, it.plate), h('div', { class: 'muted small' }, [it.name, typeLabel(it) !== it.name ? typeLabel(it) : null].filter(Boolean).join(' · ') || KIND_LABEL[it.kind])),
          badge(it.state, FLEET_STATE_LABELS[it.state])),
        h('div', { class: 'ft-use' }, usage(it)),
        h('div', { class: 'ft-chips' },
          h('span', { class: 'chip' }, KIND_LABEL[it.kind]),
          it.capacity ? h('span', { class: 'chip' }, it.capacity) : null,
          inspectionChip(it)),
        it.notes ? h('div', { class: 'muted small ft-note' }, it.notes) : null,
        h('div', { class: 'ft-actions' }, h('button', { class: 'btn small', onclick: () => edit(it.kind, it) }, 'Bearbeiten'), menu(it)));
    }

    function listView(items) {
      return h('div', { class: 'table-wrap' }, h('table', { class: 'fleet-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Kennzeichen'), h('th', {}, 'Bezeichnung'), h('th', {}, 'Zustand'), h('th', {}, 'Einsatz'), h('th', {}, 'HU/TÜV'), h('th', {}))),
        h('tbody', {}, ...items.map((it) => h('tr', {},
          h('td', { class: 'nowrap' }, h('span', { class: 'ft-mini' }, icon(it.kind === 'vehicles' ? 'truck' : 'trailer')), h('strong', {}, it.plate)),
          h('td', {}, h('div', {}, [it.name, typeLabel(it) !== it.name ? typeLabel(it) : null].filter(Boolean).join(' · ') || '–'), h('div', { class: 'muted small' }, [KIND_LABEL[it.kind], it.capacity].filter(Boolean).join(' · '))),
          h('td', {}, badge(it.state, FLEET_STATE_LABELS[it.state])),
          h('td', {}, usage(it)),
          h('td', { class: 'nowrap' }, inspectionChip(it) || '–'),
          h('td', { class: 'right nowrap' }, h('button', { class: 'btn small', onclick: () => edit(it.kind, it) }, 'Bearbeiten'), ' ', menu(it)))))));
    }

    const content = h('div', {});
    const summary = h('span', { class: 'muted small' });
    function render() {
      const f = fleetUi.q.trim().toLowerCase();
      const items = all.filter((it) =>
        (fleetUi.kind === 'all' || it.kind === fleetUi.kind) &&
        (fleetUi.state === 'all' || it.state === fleetUi.state) &&
        (!f || [it.plate, it.name, it.capacity, typeLabel(it), it.notes].some((x) => (x || '').toLowerCase().includes(f))));
      summary.textContent = `${items.length} von ${all.length} · ${all.filter((x) => x.state === 'unterwegs').length} unterwegs · ${all.filter((x) => x.state === 'werkstatt').length} in der Werkstatt`;
      content.replaceChildren(items.length
        ? (fleetUi.view === 'list' ? listView(items) : h('div', { class: 'grid cols-3 fleet-grid' }, ...items.map(tile)))
        : h('div', { class: 'empty card' }, all.length ? 'Keine Treffer für diesen Filter.' : 'Noch keine Fahrzeuge oder Anhänger angelegt.'));
      for (const [k, b] of Object.entries(kindBtns)) b.setAttribute('aria-pressed', String(fleetUi.kind === k));
      for (const [k, b] of Object.entries(viewBtns)) b.setAttribute('aria-pressed', String(fleetUi.view === k));
    }
    const nV = fleet.vehicles.length, nT = fleet.trailers.length;
    const kindBtns = {};
    const kindSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Art' },
      ...[['all', `Alle (${nV + nT})`], ['vehicles', `Fahrzeuge (${nV})`], ['trailers', `Anhänger (${nT})`]].map(([k, label]) =>
        (kindBtns[k] = h('button', { type: 'button', id: `fleet-kind-${k}`, onclick: () => { fleetUi.kind = k; render(); } }, label))));
    const viewBtns = {};
    const viewSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Ansicht' },
      viewBtns.tiles = h('button', { type: 'button', id: 'fleet-view-tiles', title: 'Kacheln', onclick: () => { fleetUi.view = 'tiles'; storeSet('lw_fleet_view', 'tiles'); render(); } }, icon('grid')),
      viewBtns.list = h('button', { type: 'button', id: 'fleet-view-list', title: 'Liste', onclick: () => { fleetUi.view = 'list'; storeSet('lw_fleet_view', 'list'); render(); } }, icon('list')));
    const stateSel = h('select', { id: 'fleet-state', onchange: (e) => { fleetUi.state = e.target.value; render(); } },
      ...[['all', 'Alle Zustände'], ['verfuegbar', 'Frei'], ['unterwegs', 'Unterwegs'], ['werkstatt', 'Werkstatt']].map(([v, l]) => h('option', { value: v, selected: fleetUi.state === v }, l)));
    const search = h('input', { type: 'search', placeholder: 'Kennzeichen, Bezeichnung …', value: fleetUi.q, oninput: (e) => { fleetUi.q = e.target.value; render(); } });
    render();
    return h('div', {},
      pageHead('Fuhrpark', h('button', { class: 'btn primary', id: 'add-vehicle', onclick: () => edit('vehicles', null) }, '+ Fahrzeug'), h('button', { class: 'btn', id: 'add-trailer', onclick: () => edit('trailers', null) }, '+ Anhänger')),
      h('div', { class: 'fleet-toolbar' }, kindSeg, stateSel, search, viewSeg),
      h('div', { class: 'mt-s' }, summary),
      h('div', { class: 'mt-s' }, content));
  },
});

/* ===================== Team ===================== */
ROUTES.push({
  re: /^\/users$/,
  roles: ['admin'],
  nav: '/users',
  page: async () => {
    const users = await api('/users');
    const roleOptions = Object.entries(ROLE_LABELS);
    const roleList = (u) => roleText(u.roles || [u.role]);

    function edit(u) {
      formDialog({
        title: u ? `Mitarbeiter bearbeiten (${u.username})` : 'Neuer Mitarbeiter',
        values: u || { roles: ['packer'], active: true },
        fields: [
          u ? null : { name: 'username', label: 'Benutzername *', required: true, hint: 'Buchstaben, Zahlen, . _ -' },
          { name: 'name', label: 'Name *', required: true },
          { name: 'roles', label: 'Rollen (auch mehrere möglich)', type: 'checkgroup', options: roleOptions, hint: 'Z. B. Packer + Fahrer, oder Administrator, der auch packt und fährt.' },
          u ? { name: 'active', label: 'Aktiv (darf sich anmelden)', type: 'checkbox' } : null,
          { name: 'password', label: u ? 'Neues Passwort (leer = unverändert)' : 'Passwort * (mind. 8 Zeichen)', type: 'password', required: !u, full: true },
        ].filter(Boolean),
        onSubmit: async (v) => {
          if (!v.roles.length) throw new Error('Bitte mindestens eine Rolle auswählen.');
          const body = u ? { name: v.name, roles: v.roles, active: v.active, password: v.password || undefined } : v;
          await api(u ? `/users/${u.id}` : '/users', { method: u ? 'PUT' : 'POST', body });
          toast('Gespeichert.');
          route();
        },
      });
    }

    return h('div', {},
      pageHead('Team', h('button', { class: 'btn primary', onclick: () => edit(null) }, '+ Mitarbeiter')),
      h('div', { class: 'info-box' }, 'Packer sehen nur ihre Packlisten, Fahrer nur ihre Touren. Administratoren sehen alles. Ein Mitarbeiter kann mehrere Rollen haben (z. B. Packer und Fahrer); ein Administrator kann zusätzlich als Packer oder Fahrer eingeteilt werden.'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Benutzername'), h('th', {}, 'Rollen'), h('th', {}, 'Status'), h('th', {}))),
        h('tbody', {}, ...users.map((u) => h('tr', {},
          h('td', {}, h('strong', {}, u.name)),
          h('td', {}, u.username),
          h('td', {}, roleList(u)),
          h('td', {}, u.active ? badge('verfuegbar', 'Aktiv') : badge('storniert', 'Gesperrt')),
          h('td', { class: 'right' }, h('button', { class: 'btn small', onclick: () => edit(u) }, 'Bearbeiten')),
        )))))
    );
  },
});

/* ===================== Einstellungen / Konto ===================== */
ROUTES.push({
  re: /^\/settings$/,
  roles: ['admin', 'packer', 'driver'],
  nav: '/settings',
  page: async () => {
    const isAdmin = hasRole('admin');
    const settings = isAdmin ? await api('/settings') : null;

    const adminCard = isAdmin
      ? h('div', { class: 'card' },
          h('h2', {}, 'Pfand für Packer'),
          h('label', { class: 'field checkbox-field' },
            h('input', { type: 'checkbox', checked: settings.packer_show_deposit, onchange: async (e) => {
              try { await api('/settings', { method: 'PUT', body: { packer_show_deposit: e.target.checked } }); toast(e.target.checked ? 'Packer dürfen Pfand jetzt sehen.' : 'Pfand ist für Packer ausgeblendet.'); }
              catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
            } }),
            h('span', {}, 'Packer dürfen Pfandbeträge sehen')),
          h('p', { class: 'muted small' }, 'Ist die Option an, können Packer in der Packliste selbst per Schalter Pfand anzeigen oder ausblenden (Standard dort: ausgeblendet). Ist sie aus, bekommen Packer Pfandbeträge gar nicht erst übertragen.'),
          )
      : null;

    // Testdaten (nur Administrator)
    let demoCard = null;
    if (isAdmin) {
      const box = h('div', {});
      const result = h('div', {});
      const loadDemo = async () => {
        const st = await api('/demo-data');
        const mk = (label, fn, cls) => h('button', { class: `btn ${cls || ''}`, type: 'button', id: label === 'Testdaten erzeugen' ? 'demo-create' : 'demo-remove', onclick: fn }, label);
        box.replaceChildren(
          h('p', { class: 'muted small' }, st.exists
            ? `Vorhanden: ${st.orders} Aufträge, ${st.vehicles} Fahrzeuge, ${st.trailers} Anhänger, ${st.users} Demo-Mitarbeiter.`
            : 'Noch keine Testdaten vorhanden.'),
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
            st.exists ? null : mk('Testdaten erzeugen', async () => {
              try {
                const res = await api('/demo-data', { method: 'POST', body: {} });
                toast('Testdaten erzeugt.');
                result.replaceChildren(h('div', { class: 'notice' },
                  `Demo-Mitarbeiter (${res.usernames.join(', ')}) haben das Passwort `, h('strong', {}, res.password),
                  '. Bitte nur zum Testen nutzen und die Testdaten danach wieder entfernen.'));
                await loadDemo();
              } catch (e) { toast(e.message, 'error'); }
            }, 'primary'),
            st.exists ? mk('Testdaten entfernen', async () => {
              if (!confirm('Alle Testdaten (Aufträge, Fahrzeuge, Anhänger, Demo-Mitarbeiter) wirklich entfernen? Eigene Daten bleiben erhalten.')) return;
              try { await api('/demo-data', { method: 'DELETE' }); toast('Testdaten entfernt.'); result.replaceChildren(); await loadDemo(); }
              catch (e) { toast(e.message, 'error'); }
            }, 'danger') : null));
      };
      await loadDemo();
      demoCard = h('div', { class: 'card mt' },
        h('h2', {}, 'Testdaten'),
        h('p', { class: 'muted small' }, 'Erzeugt Beispiel-Aufträge in allen Stadien (Packlisten, Touren, Archiv), Kunden, Fuhrpark und Demo-Mitarbeiter, damit du alles ausprobieren kannst. Lässt sich jederzeit wieder entfernen; deine eigenen Daten bleiben unberührt.'),
        box, result);
    }

    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const nw = h('input', { type: 'password', autocomplete: 'new-password' });
    const nw2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const pwCard = h('div', { class: isAdmin ? 'card mt' : 'card' },
      h('h2', {}, 'Passwort ändern'),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Aktuelles Passwort'), cur),
        h('label', { class: 'field' }, h('span', {}, 'Neues Passwort (mind. 8 Zeichen)'), nw),
        h('label', { class: 'field' }, h('span', {}, 'Neues Passwort wiederholen'), nw2)),
      h('div', { class: 'mt' }, h('button', { class: 'btn primary', onclick: async () => {
        if (nw.value !== nw2.value) { toast('Die neuen Passwörter stimmen nicht überein.', 'error'); return; }
        try { await api('/me/password', { method: 'POST', body: { current_password: cur.value, new_password: nw.value } }); toast('Passwort geändert.'); cur.value = nw.value = nw2.value = ''; }
        catch (e) { toast(e.message, 'error'); }
      } }, 'Passwort ändern')));

    return h('div', {}, pageHead(isAdmin ? 'Einstellungen' : 'Konto'), adminCard, demoCard, pwCard);
  },
});


/* ===================== Kunden ===================== */
function customerDialog(c, onDone) {
  formDialog({
    title: c ? 'Kunde bearbeiten' : 'Neuer Kunde',
    values: c || {},
    fields: [
      { name: 'name', label: 'Name / Firma *', required: true, full: true },
      { name: 'address', label: 'Straße & Hausnummer', full: true },
      { name: 'postal_code', label: 'PLZ' },
      { name: 'city', label: 'Ort' },
      { name: 'phone', label: 'Telefon' },
      { name: 'notes', label: 'Notizen (z. B. Klingel, Ansprechpartner)', type: 'textarea', full: true },
    ],
    onSubmit: async (v) => {
      const saved = await api(c ? `/customers/${c.id}` : '/customers', { method: c ? 'PUT' : 'POST', body: v });
      toast(c ? 'Kunde gespeichert.' : 'Kunde angelegt.');
      onDone(saved);
    },
  });
}

ROUTES.push({
  re: /^\/customers$/,
  roles: ['admin'],
  nav: '/customers',
  page: async () => {
    const customers = await api('/customers');
    let filter = '';
    const tbody = h('tbody');
    const count = h('span', { class: 'muted small' });
    function render() {
      const f = filter.toLowerCase();
      const list = customers.filter((c) => !f || [c.name, c.address, c.city, c.phone, c.postal_code].some((x) => (x || '').toLowerCase().includes(f)));
      count.textContent = `${list.length} ${list.length === 1 ? 'Kunde' : 'Kunden'}`;
      tbody.replaceChildren(...(list.length ? list.map((c) => h('tr', { class: 'clickable', onclick: () => (location.hash = `#/customers/${c.id}`) },
        h('td', {}, h('strong', {}, c.name)),
        h('td', {}, [c.address, [c.postal_code, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–'),
        h('td', {}, c.phone || '–'),
        h('td', { class: 'num' }, c.order_count),
        h('td', { class: 'num' }, c.delivered_count),
        h('td', { class: 'nowrap' }, fmtDate(c.last_delivery) || '–'),
        h('td', { class: 'num dep nowrap' }, eur(c.deposit_total_cents)),
      )) : [h('tr', {}, h('td', { colspan: 7, class: 'empty' }, customers.length ? 'Keine Treffer.' : 'Noch keine Kunden. Mit „+ Neuer Kunde“ den ersten anlegen.'))]));
    }
    render();
    return h('div', {},
      pageHead('Kunden', count,
        h('button', { class: 'btn primary', id: 'new-customer', onclick: () => customerDialog(null, (c) => (location.hash = `#/customers/${c.id}`)) }, '+ Neuer Kunde')),
      h('div', { class: 'info-box' }, 'Hier verwaltest du deine Kunden. Im Auftrag kannst du einen bestehenden Kunden auswählen oder direkt einen neuen anlegen. Ein Klick zeigt die komplette Lieferhistorie.'),
      h('div', { class: 'filters' }, h('input', { type: 'search', placeholder: 'Kunden suchen: Name, Adresse, Ort, Telefon …', oninput: (e) => { filter = e.target.value; render(); } })),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Kunde'), h('th', {}, 'Adresse'), h('th', {}, 'Telefon'), h('th', { class: 'num' }, 'Aufträge'), h('th', { class: 'num' }, 'Geliefert'), h('th', {}, 'Letzte Lieferung'), h('th', { class: 'num dep' }, 'Pfand gesamt'))),
        tbody)),
    );
  },
});

ROUTES.push({
  re: /^\/customers\/(\d+)$/,
  roles: ['admin'],
  nav: '/customers',
  page: async (m) => {
    const id = Number(m[1]);
    const { customer: c, orders } = await api(`/customers/${id}`);
    const stat = (n, l) => h('div', { class: 'stat' }, h('div', { class: 'stat-n' }, n), h('div', { class: 'stat-l' }, l));
    const del = c.order_count === 0
      ? h('button', { class: 'btn danger', onclick: async () => {
          if (!confirm(`Kunde "${c.name}" wirklich löschen?`)) return;
          try { await api(`/customers/${id}`, { method: 'DELETE' }); toast('Kunde gelöscht.'); location.hash = '#/customers'; } catch (e) { toast(e.message, 'error'); }
        } }, 'Löschen')
      : null;
    return h('div', {},
      pageHead(c.name, h('a', { class: 'btn', href: '#/customers' }, 'Alle Kunden'),
        h('button', { class: 'btn', id: 'edit-customer', onclick: () => customerDialog(c, () => route()) }, 'Bearbeiten'), del,
        h('a', { class: 'btn primary', href: `#/orders/new?customer_id=${id}` }, '+ Neuer Auftrag')),
      h('div', { class: 'card' },
        h('div', { class: 'form-grid' },
          h('div', {}, h('div', { class: 'muted small' }, 'Adresse'), h('div', {}, [c.address, [c.postal_code, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–')),
          h('div', {}, h('div', { class: 'muted small' }, 'Telefon'), c.phone ? h('a', { href: `tel:${c.phone.replace(/[^+\d]/g, '')}` }, c.phone) : '–'),
          c.notes ? h('div', { class: 'full' }, h('div', { class: 'muted small' }, 'Notizen'), h('div', {}, c.notes)) : null)),
      h('div', { class: 'grid stats mt' },
        stat(c.order_count, 'Aufträge'), stat(c.delivered_count, 'Geliefert'), stat(fmtDate(c.last_delivery) || '–', 'Letzte Lieferung'),
        h('div', { class: 'stat dep' }, h('div', { class: 'stat-n' }, eur(c.deposit_total_cents)), h('div', { class: 'stat-l' }, 'Pfand gesamt'))),
      h('h2', { class: 'mt' }, 'Lieferhistorie'),
      ordersTable(orders),
    );
  },
});

/* Tabelle mit Aufträgen (Kunden-Historie & Archiv) */
function ordersTable(orders) {
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Nr.'), h('th', {}, 'Lieferung'), h('th', {}, 'Status'), h('th', {}, 'Positionen'), h('th', {}, 'Fahrer'), h('th', {}, 'Fahrzeug / Anhänger'), h('th', { class: 'num dep' }, 'Pfand'))),
    h('tbody', {}, ...(orders.length ? orders.map((o) => h('tr', { class: 'clickable', onclick: () => (location.hash = `#/orders/${o.id}`) },
      h('td', { class: 'nowrap' }, h('strong', {}, o.number)),
      h('td', { class: 'nowrap' }, fmtDate(o.delivery_date) || '–'),
      h('td', {}, statusBadge(o.status)),
      h('td', {}, o.item_count),
      h('td', {}, o.driver_name || '–'),
      h('td', {}, [o.vehicle_plate, o.trailer_plate].filter(Boolean).join(' + ') || '–'),
      h('td', { class: 'num dep nowrap' }, eur(o.deposit_total_cents)))) : [h('tr', {}, h('td', { colspan: 7, class: 'empty' }, 'Keine Aufträge.'))]))));
}

/* ===================== Archiv ===================== */
ROUTES.push({
  re: /^\/archive$/,
  roles: ['admin'],
  nav: '/archive',
  page: async () => {
    const f = { status: 'archiv', from: '', to: '', q: '' };
    let current = [];
    const holder = h('div');
    const count = h('span', { class: 'muted small' });
    async function load() {
      const params = new URLSearchParams({ status: f.status });
      if (f.from) params.set('from', f.from);
      if (f.to) params.set('to', f.to);
      if (f.q) params.set('q', f.q);
      try {
        current = await api(`/orders?${params}`);
        count.textContent = `${current.length} ${current.length === 1 ? 'Auftrag' : 'Aufträge'}`;
        holder.replaceChildren(ordersTableWithCustomer(current));
      } catch (e) { holder.replaceChildren(errorBox(e)); }
    }
    function ordersTableWithCustomer(orders) {
      return h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Nr.'), h('th', {}, 'Kunde'), h('th', {}, 'Ort'), h('th', {}, 'Lieferung'), h('th', {}, 'Status'), h('th', {}, 'Fahrer'), h('th', {}, 'Fahrzeug / Anhänger'), h('th', { class: 'num dep' }, 'Pfand'))),
        h('tbody', {}, ...(orders.length ? orders.map((o) => h('tr', { class: 'clickable', onclick: () => (location.hash = `#/orders/${o.id}`) },
          h('td', { class: 'nowrap' }, h('strong', {}, o.number)),
          h('td', {}, o.customer_name),
          h('td', {}, o.city || ''),
          h('td', { class: 'nowrap' }, fmtDate(o.delivery_date) || '–'),
          h('td', {}, statusBadge(o.status)),
          h('td', {}, o.driver_name || '–'),
          h('td', {}, [o.vehicle_plate, o.trailer_plate].filter(Boolean).join(' + ') || '–'),
          h('td', { class: 'num dep nowrap' }, eur(o.deposit_total_cents)))) : [h('tr', {}, h('td', { colspan: 8, class: 'empty' }, 'Im Archiv ist nichts zu diesen Filtern.'))]))));
    }
    function exportCsv() {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [['Nummer', 'Kunde', 'Adresse', 'PLZ', 'Ort', 'Lieferdatum', 'Status', 'Fahrer', 'Fahrzeug', 'Anhänger', 'Positionen', 'Pfand (EUR)']];
      for (const o of current) rows.push([o.number, o.customer_name, o.address, o.postal_code, o.city, o.delivery_date, STATUS_LABELS[o.status], o.driver_name, o.vehicle_plate, o.trailer_plate, o.item_count, o.deposit_total_cents === undefined ? '' : (o.deposit_total_cents / 100).toFixed(2).replace('.', ',')]);
      const blob = new Blob(['\ufeff' + rows.map((r) => r.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `archiv-${todayISO()}.csv` });
      document.body.append(a); a.click(); a.remove();
    }
    let timer;
    load();
    return h('div', {},
      pageHead('Archiv', count, h('button', { class: 'btn', onclick: exportCsv }, 'Als CSV exportieren')),
      h('div', { class: 'info-box' }, 'Alle erledigten Lieferungen (geliefert) und stornierten Aufträge. Ein Klick öffnet den Auftrag.'),
      h('div', { class: 'filters' },
        h('select', { onchange: (e) => { f.status = e.target.value; load(); } }, h('option', { value: 'archiv' }, 'Geliefert & storniert'), h('option', { value: 'geliefert' }, 'Nur geliefert'), h('option', { value: 'storniert' }, 'Nur storniert')),
        h('label', { class: 'inline-date' }, 'von ', h('input', { type: 'date', onchange: (e) => { f.from = e.target.value; load(); } })),
        h('label', { class: 'inline-date' }, 'bis ', h('input', { type: 'date', onchange: (e) => { f.to = e.target.value; load(); } })),
        h('input', { type: 'search', placeholder: 'Suche: Kunde, Nummer, Ort …', oninput: (e) => { clearTimeout(timer); timer = setTimeout(() => { f.q = e.target.value.trim(); load(); }, 250); } })),
      holder);
  },
});
