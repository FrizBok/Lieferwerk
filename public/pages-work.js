'use strict';

/* ===================== Packlisten: Übersicht (Packer & Admin) ===================== */
ROUTES.push({
  re: /^\/pack$/,
  roles: ['packer', 'admin'],
  nav: '/pack',
  page: async () => {
    const root = h('div');
    const isAdmin = hasRole('admin');

    function packCard(o, claimable) {
      return h('a', { class: 'card pack-card', href: `#/pack/${o.id}` },
        h('div', { class: 'row between' },
          h('h3', {}, `${o.number} · ${o.customer_name}`),
          statusBadge(o.status)),
        h('div', { class: 'muted' }, [o.city, fmtDate(o.delivery_date), o.time_window].filter(Boolean).join(' · ') || 'Kein Lieferdatum'),
        isAdmin && o.packer_name ? h('div', { class: 'muted small' }, `Packer: ${o.packer_name}`) : null,
        h('div', { class: 'row between small muted mt-s' },
          h('span', {}, `${o.packed_count} von ${o.item_count} Positionen gepackt`),
          claimable ? h('span', { class: 'badge neu' }, 'noch frei') : null),
        progressBar(o.packed_count, o.item_count));
    }

    function group(title, orders, claimable) {
      if (!orders.length) return null;
      return h('div', {}, h('div', { class: 'group-title' }, title), h('div', { class: 'grid cols-3' }, ...orders.map((o) => packCard(o, claimable))));
    }

    async function load() {
      try {
        const orders = await api('/pack/orders');
        const todo = orders.filter((o) => o.status === 'neu' || o.status === 'packen');
        const done = orders.filter((o) => o.status === 'gepackt');
        const mine = todo.filter((o) => o.packer_id === state.user.id);
        const free = todo.filter((o) => o.packer_id === null);
        const parts = isAdmin
          ? [group('Zu packen', todo, false), group('Fertig gepackt', done, false)]
          : [group('Meine Packlisten', mine, false), group('Noch nicht zugewiesen – übernehmen', free, true), group('Fertig gepackt', done, false)];
        root.replaceChildren(...(orders.length ? parts : [h('div', { class: 'empty card' }, 'Aktuell gibt es nichts zu packen. 🎉')]));
      } catch (e) {
        root.replaceChildren(errorBox(e));
      }
    }
    await load();
    state.timer = setInterval(load, 30000);
    return h('div', {}, pageHead('Packlisten', h('span', { class: 'muted small' }, 'aktualisiert sich automatisch')), root);
  },
});

/* ===================== Packliste: Detail ===================== */
ROUTES.push({
  re: /^\/pack\/(\d+)$/,
  roles: ['packer', 'admin'],
  nav: '/pack',
  page: async (m) => {
    const id = Number(m[1]);
    let order = await api(`/pack/orders/${id}`);
    const root = h('div');
    let queue = Promise.resolve();

    function enqueue(fn) {
      queue = queue.then(fn).catch(() => {});
      return queue;
    }

    function setPacked(it, qty) {
      it.packed_qty = Math.max(0, Math.min(it.quantity, qty));
      if (order.status === 'neu') order.status = 'packen';
      render();
      const wanted = it.packed_qty;
      enqueue(async () => {
        try {
          order = await api(`/pack/items/${it.id}`, { method: 'POST', body: { packed_qty: wanted } });
        } catch (e) {
          toast(e.message, 'error', 5000);
          try { order = await api(`/pack/orders/${id}`); } catch { /* ignorieren */ }
        }
        render();
      });
    }

    function itemRow(it, locked) {
      const full = it.packed_qty >= it.quantity;
      const stepper = Number.isInteger(it.quantity) && it.quantity > 1 && it.quantity <= 999;
      const hasDeposit = it.deposit_cents !== undefined;
      return h('div', { class: `pack-item${full ? ' done' : ''}` },
        h('button', {
          class: 'pack-check', disabled: locked, 'aria-label': full ? 'Als nicht gepackt markieren' : 'Als gepackt markieren',
          onclick: () => setPacked(it, full ? 0 : it.quantity),
        }, '✓'),
        h('div', { class: 'pi-body' },
          h('div', { class: 'pi-name' }, it.name),
          h('div', { class: 'pi-meta' },
            badge(it.packaging, it.packaging === 'kasten' ? 'Kasten' : 'einzeln'),
            it.note ? h('span', {}, it.note) : null,
            hasDeposit && it.deposit_cents > 0 ? h('span', { class: 'dep' }, `Pfand ${eur(it.deposit_cents)}${it.deposit_rule_name ? ` · ${it.deposit_rule_name}` : ''}`) : null)),
        stepper
          ? h('div', { class: 'stepper' },
              h('button', { disabled: locked || it.packed_qty <= 0, 'aria-label': 'Eins weniger', onclick: () => setPacked(it, it.packed_qty - 1) }, '−'),
              h('div', { class: 'count' }, `${fmtQty(it.packed_qty)}/${fmtQty(it.quantity)}`),
              h('button', { disabled: locked || full, 'aria-label': 'Eins mehr', onclick: () => setPacked(it, it.packed_qty + 1) }, '+'))
          : h('div', { class: 'pi-qty' }, `${fmtQty(it.quantity)} ${it.unit}`));
    }

    function depositToggle() {
      return h('button', {
        class: `btn toggle${state.showDeposit ? '' : ' off'}`, 'aria-pressed': String(state.showDeposit),
        onclick: () => {
          state.showDeposit = !state.showDeposit;
          localStorage.setItem('lw_show_deposit_packer', state.showDeposit ? '1' : '0');
          applyDepositVisibility();
          render();
        },
      }, state.showDeposit ? 'Pfand ausblenden' : 'Pfand anzeigen');
    }

    function render() {
      const locked = !['neu', 'packen'].includes(order.status);
      const done = order.items.filter((i) => i.packed_qty >= i.quantity).length;
      const total = order.items.length;
      const hasDeposit = order.deposit_total_cents !== undefined;
      const footer = locked
        ? h('div', { class: 'pack-footer' },
            order.status === 'gepackt' ? h('button', { class: 'btn big', onclick: () => reopen() }, 'Wieder öffnen') : null,
            h('a', { class: 'btn big primary', href: '#/pack' }, 'Zur Übersicht'))
        : h('div', { class: 'pack-footer' },
            h('button', { class: 'btn big primary', onclick: () => complete() }, `Fertig gepackt (${done}/${total})`));

      root.replaceChildren(
        h('div', { class: 'page-head' },
          h('a', { class: 'btn', href: '#/pack' }, '← Zurück'),
          h('h1', {}, `${order.number} · ${order.customer_name}`),
          h('div', { class: 'spacer' }),
          statusBadge(order.status),
          hasDeposit && hasRole('packer') && !hasRole('admin') ? depositToggle() : null,
          h('a', { class: 'btn', href: `#/orders/${id}/print` }, 'Drucken')),
        h('div', { class: 'card' },
          h('div', { class: 'muted' }, [addressLine(order), fmtDate(order.delivery_date), order.time_window].filter(Boolean).join(' · ') || 'Kein Lieferdatum'),
          order.notes ? h('div', { class: 'notice warn mt-s' }, order.notes) : null,
          h('div', { class: 'row between mt-s' },
            h('span', { class: 'muted' }, `${done} von ${total} Positionen gepackt`),
            hasDeposit ? h('strong', { class: 'dep' }, `Pfand gesamt: ${eur(order.deposit_total_cents)}`) : null),
          progressBar(done, total),
          !order.packer_id && hasRole('packer') && !locked
            ? h('div', { class: 'mt-s' }, h('button', { class: 'btn', onclick: () => take() }, 'Auftrag übernehmen')) : null),
        h('div', { class: 'stack mt' }, ...(order.items.length ? order.items.map((it) => itemRow(it, locked)) : [h('div', { class: 'empty card' }, 'Dieser Auftrag hat keine Positionen.')])),
        footer);
    }

    async function take() {
      try { order = await api(`/pack/orders/${id}/take`, { method: 'POST', body: {} }); toast('Auftrag übernommen.'); render(); } catch (e) { toast(e.message, 'error'); }
    }
    async function reopen() {
      try { order = await api(`/pack/orders/${id}/reopen`, { method: 'POST', body: {} }); render(); } catch (e) { toast(e.message, 'error'); }
    }
    async function complete() {
      await queue;
      const open = order.items.filter((i) => i.packed_qty < i.quantity).length;
      let force = false;
      if (open > 0) {
        if (!confirm(`Es sind noch ${open} Position(en) nicht vollständig gepackt. Trotzdem als fertig melden?`)) return;
        force = true;
      }
      try { order = await api(`/pack/orders/${id}/complete`, { method: 'POST', body: { force } }); toast('Packliste abgeschlossen.'); render(); } catch (e) { toast(e.message, 'error'); }
    }

    render();
    return root;
  },
});

/* ===================== Fahrer: Touren ===================== */
ROUTES.push({
  re: /^\/driver$/,
  roles: ['driver', 'admin'],
  nav: '/driver',
  page: async () => {
    const root = h('div');
    const isAdmin = hasRole('admin');

    async function setStatus(o, status) {
      try { await api(`/driver/orders/${o.id}/status`, { method: 'POST', body: { status } }); toast(status === 'unterwegs' ? 'Gute Fahrt!' : status === 'geliefert' ? 'Als geliefert markiert.' : 'Zurückgesetzt.'); await load(); }
      catch (e) { toast(e.message, 'error'); }
    }

    function card(o) {
      const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([o.address, o.postal_code, o.city].filter(Boolean).join(' '))}`;
      const hasDeposit = o.deposit_total_cents !== undefined;
      return h('div', { class: 'card driver-card' },
        h('div', { class: 'row between' }, h('h3', {}, o.stop_order > 0 ? `Stopp ${o.stop_order} · ` : '', `${o.number} · ${o.customer_name}`), statusBadge(o.status)),
        h('div', {}, addressLine(o) || 'Keine Adresse hinterlegt'),
        h('div', { class: 'muted' }, [fmtDate(o.delivery_date), o.time_window].filter(Boolean).join(' · ')),
        h('div', { class: 'muted small' }, [isAdmin && o.driver_name ? `Fahrer: ${o.driver_name}` : null, o.vehicle_plate ? `Fahrzeug: ${o.vehicle_plate}` : null, o.trailer_plate ? `Anhänger: ${o.trailer_plate}` : null].filter(Boolean).join(' · ')),
        o.notes ? h('div', { class: 'notice warn mt-s' }, o.notes) : null,
        o.has_signature ? h('div', { class: 'notice mt-s' }, `✓ Unterschrieben von ${o.signed_name} (${String(o.signed_at).slice(0, 16)})`) : null,
        hasDeposit ? h('div', { class: 'dep mt-s' }, h('strong', {}, `Pfand: ${eur(o.deposit_total_cents)}`)) : null,
        h('details', {}, h('summary', {}, `Ladung (${o.items.length} Positionen)`),
          h('ul', {}, ...o.items.map((it) => h('li', {}, `${fmtQty(it.quantity)} ${it.unit} ${it.name}`, it.packaging === 'kasten' ? ' (Kasten)' : '')))),
        h('div', { class: 'actions' },
          h('a', { class: 'btn', href: maps, target: '_blank', rel: 'noopener noreferrer' }, 'Navigation'),
          o.phone ? h('a', { class: 'btn', href: `tel:${o.phone.replace(/[^+\d]/g, '')}` }, `Anrufen`) : null,
          h('a', { class: 'btn', href: `/api/orders/${o.id}/lieferschein.pdf`, target: '_blank', rel: 'noopener' }, 'Lieferschein (PDF)'),
          o.status !== 'neu' && o.status !== 'packen' ? h('button', { class: 'btn', onclick: () => signatureDialog(o, () => load()) }, o.has_signature ? 'Neu unterschreiben lassen' : 'Unterschrift einholen') : null,
          o.status === 'gepackt' ? h('button', { class: 'btn primary big', onclick: () => setStatus(o, 'unterwegs') }, 'Losfahren') : null,
          o.status === 'unterwegs' ? [h('button', { class: 'btn primary big', onclick: () => setStatus(o, 'geliefert') }, 'Geliefert'), h('button', { class: 'btn', onclick: () => setStatus(o, 'gepackt') }, 'Zurück')] : null,
          o.status === 'geliefert' ? h('button', { class: 'btn', onclick: () => setStatus(o, 'unterwegs') }, 'Doch noch unterwegs') : null));
    }

    async function load() {
      try {
        const orders = await api('/driver/orders');
        const active = orders.filter((o) => o.status !== 'geliefert');
        const delivered = orders.filter((o) => o.status === 'geliefert');
        root.replaceChildren(...[
          orders.length ? null : h('div', { class: 'empty card' }, 'Keine Touren zugewiesen oder noch nicht gepackt.'),
          active.length ? h('div', { class: 'stack' }, ...active.map(card)) : null,
          delivered.length ? h('div', {}, h('div', { class: 'group-title' }, 'Heute geliefert'), h('div', { class: 'stack' }, ...delivered.map(card))) : null,
        ].filter(Boolean));
      } catch (e) {
        root.replaceChildren(errorBox(e));
      }
    }
    await load();
    state.timer = setInterval(load, 30000);
    return h('div', {}, pageHead(isAdmin ? 'Touren (alle Fahrer)' : 'Meine Touren'), root);
  },
});
