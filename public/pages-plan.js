'use strict';

/* ===================== Tagesplanung ===================== */
const planUi = { date: null };

function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

ROUTES.push({
  re: /^\/plan$/,
  roles: ['admin'],
  nav: '/plan',
  page: async (_m, q) => {
    if (q.get('date')) planUi.date = q.get('date');
    if (!planUi.date) planUi.date = todayISO();
    const board = h('div', {});
    const head = h('div', { class: 'plan-nav' });
    let data = null;

    async function load() {
      data = await api(`/plan?date=${planUi.date}`);
      render();
    }
    const call = async (fn) => { try { await fn(); await load(); } catch (e) { toast(e.message, 'error'); } };

    function colOrders(driverId) {
      return data.orders.filter((o) => (o.driver_id ?? null) === driverId);
    }

    function card(o, list, idx) {
      const warns = data.warnings[o.id] || [];
      const el = h('div', { class: `plan-card st-${o.status}`, draggable: 'true', 'data-id': o.id },
        h('div', { class: 'pc-top' },
          h('span', { class: 'pc-stop' }, o.driver_id !== null ? `${idx + 1}` : '•'),
          h('a', { class: 'pc-title', href: `#/orders/${o.id}` }, o.customer_name),
          statusBadge(o.status)),
        h('div', { class: 'muted small' }, [o.time_window, [o.postal_code, o.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'Keine Zeit/Ort'),
        h('div', { class: 'muted small' }, `${o.number} · ${o.item_count} Position${o.item_count === 1 ? '' : 'en'}${o.packer_name ? ' · Packer ' + o.packer_name : ''}`),
        warns.length ? h('div', { class: 'pc-warn' }, ...warns.map((w) => h('div', {}, '⚠ ' + w))) : null,
        o.driver_id !== null ? h('div', { class: 'pc-move' },
          h('button', { class: 'btn small', title: 'Nach oben', 'aria-label': 'Nach oben', disabled: idx === 0, onclick: () => move(list, idx, -1) }, '↑'),
          h('button', { class: 'btn small', title: 'Nach unten', 'aria-label': 'Nach unten', disabled: idx === list.length - 1, onclick: () => move(list, idx, 1) }, '↓')) : null);
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(o.id)); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      return el;
    }

    function move(list, idx, delta) {
      const ids = list.map((o) => o.id);
      const [x] = ids.splice(idx, 1);
      ids.splice(idx + delta, 0, x);
      call(() => api('/plan/reorder', { method: 'POST', body: { ids } }));
    }

    async function drop(driverId, e, beforeId) {
      e.preventDefault();
      const id = Number(e.dataTransfer.getData('text/plain'));
      const o = data.orders.find((x) => x.id === id);
      if (!o) return;
      await call(async () => {
        if ((o.driver_id ?? null) !== driverId) await api(`/plan/orders/${id}`, { method: 'PUT', body: { driver_id: driverId } });
        if (driverId !== null) {
          const ids = colOrders(driverId).filter((x) => x.id !== id).map((x) => x.id);
          const at = beforeId ? ids.indexOf(beforeId) : -1;
          if (at >= 0) ids.splice(at, 0, id); else ids.push(id);
          await api('/plan/reorder', { method: 'POST', body: { ids } });
        }
      });
    }

    function column(driver) {
      const driverId = driver ? driver.id : null;
      const list = colOrders(driverId);
      const same = (key) => (list.length && list.every((o) => o[key] === list[0][key]) ? list[0][key] : list.length ? 'mixed' : null);
      const tourSel = (label, key, opts) => {
        const cur = same(key);
        return h('select', { class: 'pc-sel', 'aria-label': label, disabled: !list.length, onchange: (e) => call(() => api('/plan/tour', { method: 'POST', body: { date: data.date, driver_id: driverId, [key]: e.target.value ? Number(e.target.value) : null } })) },
          h('option', { value: '' }, cur === 'mixed' ? `${label}: gemischt` : `${label}: –`),
          ...opts.map((x) => h('option', { value: x.id, selected: cur === x.id }, x.plate + (x.status === 'werkstatt' ? ' (Werkstatt)' : ''))));
      };
      const col = h('div', { class: `plan-col${driver ? '' : ' unassigned'}`, 'data-driver': driverId ?? 'none' },
        h('div', { class: 'pc-head' },
          h('strong', {}, driver ? driver.name : 'Nicht zugewiesen'),
          h('span', { class: 'muted small' }, `${list.length} Auftrag${list.length === 1 ? '' : 'e'}`)),
        driver ? h('div', { class: 'pc-tour' }, tourSel('Fahrzeug', 'vehicle_id', data.vehicles), tourSel('Anhänger', 'trailer_id', data.trailers)) : null,
        h('div', { class: 'pc-list' }, ...(list.length ? list.map((o, i) => card(o, list, i)) : [h('div', { class: 'pc-empty muted small' }, driver ? 'Aufträge hierher ziehen' : 'Alles zugewiesen')])));
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
      col.addEventListener('drop', (e) => {
        col.classList.remove('over');
        const target = e.target.closest('.plan-card');
        drop(driverId, e, target ? Number(target.getAttribute('data-id')) : null);
      });
      return col;
    }

    function render() {
      const d = data.date;
      const dt = new Date(d + 'T00:00:00');
      head.replaceChildren(
        h('button', { class: 'btn', id: 'plan-prev', 'aria-label': 'Vorheriger Tag', onclick: () => go(shiftDate(d, -1)) }, '‹'),
        h('input', { type: 'date', id: 'plan-date', value: d, onchange: (e) => e.target.value && go(e.target.value) }),
        h('button', { class: 'btn', id: 'plan-next', 'aria-label': 'Nächster Tag', onclick: () => go(shiftDate(d, 1)) }, '›'),
        h('button', { class: 'btn', onclick: () => go(todayISO()) }, 'Heute'),
        h('strong', { class: 'plan-day' }, `${WEEKDAYS[dt.getDay()]}, ${fmtDate(d)}`),
        h('span', { class: 'muted small' }, `${data.orders.length} Aufträge · ${data.orders.filter((o) => o.driver_id === null).length} ohne Fahrer`));
      const undated = data.undated.length
        ? h('div', { class: 'card mt' }, h('h2', {}, `Ohne Lieferdatum (${data.undated.length})`),
            h('div', { class: 'plan-undated' }, ...data.undated.map((o) => h('div', { class: 'plan-undated-row' },
              h('a', { href: `#/orders/${o.id}` }, `${o.number} · ${o.customer_name}`), h('span', { class: 'muted small' }, o.city || ''),
              h('button', { class: 'btn small', onclick: () => call(() => api(`/plan/orders/${o.id}`, { method: 'PUT', body: { delivery_date: data.date } })) }, 'Auf diesen Tag')))))
        : null;
      board.replaceChildren(
        h('div', { class: 'plan-board' }, column(null), ...data.drivers.map(column)),
        data.drivers.length ? null : h('div', { class: 'notice warn mt' }, 'Es gibt noch keine Fahrer. Lege unter „Team“ Mitarbeiter mit der Rolle Fahrer an.'),
        undated);
    }
    function go(date) { planUi.date = date; location.hash = `#/plan?date=${date}`; }

    await load();
    return h('div', {}, pageHead('Tagesplanung'), head,
      h('div', { class: 'info-box' }, 'Ziehe Aufträge auf einen Fahrer oder nutze ↑ ↓ für die Reihenfolge der Stopps. Fahrzeug und Anhänger gelten für die ganze Tour des Fahrers.'),
      board);
  },
});
