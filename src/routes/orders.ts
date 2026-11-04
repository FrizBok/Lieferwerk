import { all, get, run, tx } from '../db.ts';
import { requireRole } from '../auth.ts';
import { calcDepositCents } from '../lib/deposit.ts';
import type { DepositRule } from '../lib/deposit.ts';
import { getOrder, queryOrders } from '../lib/orders.ts';
import { findOrCreateCustomer } from '../lib/customers.ts';
import { addDays, fmtDate, todayStr } from '../lib/util.ts';
import {
  bad,
  HttpError,
  oneOf,
  optDate,
  optId,
  optInt,
  optStr,
  reqId,
  reqNum,
  reqStr,
} from '../lib/validate.ts';
import { ORDER_STATUSES, PACKAGINGS } from '../types.ts';
import type { Router } from '../lib/web.ts';
import { fleetOverview } from './fleet.ts';

const admin = requireRole('admin');

interface ParsedItem {
  id: number | null;
  product_id: number | null;
  name: string;
  quantity: number;
  unit: string;
  packaging: string;
  deposit_rule_id: number | null;
  deposit_override_cents: number | null;
  note: string | null;
}

function parseItems(raw: unknown): ParsedItem[] {
  if (!Array.isArray(raw)) bad('Positionen fehlen');
  const list = raw as any[];
  if (list.length > 500) bad('Zu viele Positionen (max. 500)');
  return list.map((r) => {
    if (!r || typeof r !== 'object') bad('Ungültige Position');
    const productId = optId(r.product_id, 'Produkt');
    const ruleId = optId(r.deposit_rule_id, 'Pfandregel');
    if (productId !== null && !get('SELECT id FROM products WHERE id = ?', productId)) bad('Produkt nicht gefunden');
    if (ruleId !== null && !get('SELECT id FROM deposit_rules WHERE id = ?', ruleId)) bad('Pfandregel nicht gefunden');
    return {
      id: optId(r.id, 'Positions-ID'),
      product_id: productId,
      name: reqStr(r.name, 'Produktname', 200),
      quantity: reqNum(r.quantity, 'Menge', 0.001, 100_000),
      unit: optStr(r.unit, 'Einheit', 20) ?? 'Stk',
      packaging: oneOf(r.packaging ?? 'einzeln', PACKAGINGS, 'Verpackung'),
      deposit_rule_id: ruleId,
      deposit_override_cents: optInt(r.deposit_override_cents, 'Pfand (manuell)', 0, 10_000_000),
      note: optStr(r.note, 'Notiz', 300),
    };
  });
}

function checkRef(table: 'users' | 'vehicles' | 'trailers', id: number | null, extra: string, msg: string): number | null {
  if (id === null) return null;
  if (!get(`SELECT id FROM ${table} WHERE id = ? ${extra}`, id)) bad(msg);
  return id;
}

/** Kunde zum Auftrag: gewaehlter Kunde, sonst vorhandenen mit gleichen Daten finden oder neu anlegen. */
function resolveCustomerId(body: any, d: { customer_name: string; address: string | null; postal_code: string | null; city: string | null; phone: string | null }): number {
  const given = optId(body.customer_id, 'Kunde');
  if (given !== null) {
    if (!get('SELECT id FROM customers WHERE id = ?', given)) bad('Kunde nicht gefunden');
    return given;
  }
  return findOrCreateCustomer(d);
}

function parseOrder(body: any) {
  return {
    customer_name: reqStr(body.customer_name, 'Kundenname', 120),
    address: optStr(body.address, 'Adresse', 200),
    postal_code: optStr(body.postal_code, 'PLZ', 10),
    city: optStr(body.city, 'Ort', 80),
    phone: optStr(body.phone, 'Telefon', 40),
    delivery_date: optDate(body.delivery_date, 'Lieferdatum'),
    time_window: optStr(body.time_window, 'Zeitfenster', 50),
    notes: optStr(body.notes, 'Notizen', 2000),
    packer_id: checkRef('users', optId(body.packer_id, 'Packer'), "AND (',' || roles || ',') LIKE '%,packer,%' AND active = 1", 'Packer nicht gefunden'),
    driver_id: checkRef('users', optId(body.driver_id, 'Fahrer'), "AND (',' || roles || ',') LIKE '%,driver,%' AND active = 1", 'Fahrer nicht gefunden'),
    vehicle_id: checkRef('vehicles', optId(body.vehicle_id, 'Fahrzeug'), '', 'Fahrzeug nicht gefunden'),
    trailer_id: checkRef('trailers', optId(body.trailer_id, 'Anhänger'), '', 'Anhänger nicht gefunden'),
  };
}

/** Schreibt die Positionen: bestehende (per id) werden aktualisiert, neue angelegt, fehlende geloescht. */
function saveItems(orderId: number, items: ParsedItem[]): void {
  const rules = new Map<number, DepositRule>(
    all<DepositRule>('SELECT * FROM deposit_rules').map((x) => [x.id, x]),
  );
  const existing = new Map<number, any>(
    all('SELECT id, packed_qty FROM order_items WHERE order_id = ?', orderId).map((x) => [x.id, x]),
  );
  const keep = new Set<number>();
  items.forEach((it, index) => {
    const deposit =
      it.deposit_override_cents ??
      calcDepositCents(it.deposit_rule_id ? rules.get(it.deposit_rule_id) : null, it.packaging, it.quantity);
    const prior = it.id !== null ? existing.get(it.id) : undefined;
    if (prior) {
      keep.add(it.id as number);
      run(
        `UPDATE order_items SET product_id = ?, name = ?, quantity = ?, unit = ?, packaging = ?, deposit_rule_id = ?,
                deposit_override_cents = ?, deposit_cents = ?, packed_qty = ?, note = ?, position = ?
          WHERE id = ?`,
        it.product_id,
        it.name,
        it.quantity,
        it.unit,
        it.packaging,
        it.deposit_rule_id,
        it.deposit_override_cents,
        deposit,
        Math.min(prior.packed_qty, it.quantity),
        it.note,
        index,
        it.id,
      );
    } else {
      run(
        `INSERT INTO order_items (order_id, product_id, name, quantity, unit, packaging, deposit_rule_id,
                                  deposit_override_cents, deposit_cents, note, position)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        orderId,
        it.product_id,
        it.name,
        it.quantity,
        it.unit,
        it.packaging,
        it.deposit_rule_id,
        it.deposit_override_cents,
        deposit,
        it.note,
        index,
      );
    }
  });
  for (const id of existing.keys()) {
    if (!keep.has(id)) run('DELETE FROM order_items WHERE id = ?', id);
  }
}

/** Hinweise (keine Fehler) bei Doppelbelegung oder Werkstatt. */
function conflictWarnings(orderId: number): string[] {
  const o = get<any>('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) return [];
  const warnings: string[] = [];
  const checks: { col: 'vehicle_id' | 'trailer_id' | 'driver_id'; table: 'vehicles' | 'trailers' | 'users'; label: string }[] = [
    { col: 'vehicle_id', table: 'vehicles', label: 'Fahrzeug' },
    { col: 'trailer_id', table: 'trailers', label: 'Anhänger' },
    { col: 'driver_id', table: 'users', label: 'Fahrer' },
  ];
  const finished = ['geliefert', 'storniert'].includes(o.status);
  for (const c of checks) {
    if (o[c.col] === null || finished) continue;
    const res = get<any>(`SELECT * FROM ${c.table} WHERE id = ?`, o[c.col]);
    if (!res) continue;
    const label = `${c.label} ${c.table === 'users' ? res.name : res.plate}`;
    if (c.table !== 'users' && res.status === 'werkstatt') warnings.push(`${label} ist in der Werkstatt.`);
    if (o.delivery_date) {
      const others = all<any>(
        `SELECT number, customer_name FROM orders
          WHERE ${c.col} = ? AND delivery_date = ? AND id <> ? AND status NOT IN ('geliefert','storniert')`,
        o[c.col],
        o.delivery_date,
        orderId,
      );
      for (const x of others) {
        warnings.push(`${label} ist am ${fmtDate(o.delivery_date)} auch Auftrag ${x.number} (${x.customer_name}) zugeordnet.`);
      }
    }
    const away = all<any>(
      `SELECT number FROM orders WHERE ${c.col} = ? AND status = 'unterwegs' AND id <> ?`,
      o[c.col],
      orderId,
    );
    for (const x of away) warnings.push(`${label} ist noch mit Auftrag ${x.number} unterwegs.`);
  }
  return warnings;
}

function nextNumber(id: number): string {
  return `A${new Date().getFullYear()}-${String(id).padStart(4, '0')}`;
}

export function register(r: Router): void {
  r.get('/lookups', admin, () => ({
    packers: all("SELECT id, name FROM users WHERE (',' || roles || ',') LIKE '%,packer,%' AND active = 1 ORDER BY name"),
    drivers: all("SELECT id, name FROM users WHERE (',' || roles || ',') LIKE '%,driver,%' AND active = 1 ORDER BY name"),
    vehicles: all('SELECT id, plate, name, status FROM vehicles ORDER BY plate'),
    trailers: all('SELECT id, plate, name, status FROM trailers ORDER BY plate'),
    products: all('SELECT * FROM products ORDER BY category, name'),
    deposit_rules: all('SELECT * FROM deposit_rules ORDER BY name'),
    customers: all('SELECT id, name, address, postal_code, city, phone FROM customers ORDER BY lower(name) LIMIT 5000'),
  }));

  r.get('/orders', admin, (ctx) => {
    const where: string[] = [];
    const params: (string | number)[] = [];
    const status = ctx.query.get('status');
    if (status) {
      if (status === 'offen') where.push("o.status IN ('neu','packen','gepackt','unterwegs')");
      else if (status === 'archiv') where.push("o.status IN ('geliefert','storniert')");
      else {
        where.push('o.status = ?');
        params.push(oneOf(status, ORDER_STATUSES, 'Status'));
      }
    }
    const from = optDate(ctx.query.get('from'), 'Von-Datum');
    const to = optDate(ctx.query.get('to'), 'Bis-Datum');
    if (from) {
      where.push('o.delivery_date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('o.delivery_date <= ?');
      params.push(to);
    }
    const date = optDate(ctx.query.get('date'), 'Datum');
    if (date) {
      where.push('o.delivery_date = ?');
      params.push(date);
    }
    const q = (ctx.query.get('q') ?? '').trim();
    if (q) {
      where.push('(o.customer_name LIKE ? OR o.number LIKE ? OR o.city LIKE ? OR o.address LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    return queryOrders(ctx.user!, where.join(' AND '), params, { newestFirst: status === 'archiv' });
  });

  r.get('/orders/:id', admin, (ctx) => {
    const order = getOrder(ctx.user!, reqId(ctx.params.id, 'ID'));
    if (!order) throw new HttpError(404, 'Auftrag nicht gefunden');
    return order;
  });

  r.post('/orders', admin, (ctx) => {
    const d = parseOrder(ctx.body);
    const items = parseItems(ctx.body.items ?? []);
    const id = tx(() => {
      const created = run(
        `INSERT INTO orders (customer_name, address, postal_code, city, phone, delivery_date, time_window, notes,
                             packer_id, driver_id, vehicle_id, trailer_id, created_by, customer_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        d.customer_name,
        d.address,
        d.postal_code,
        d.city,
        d.phone,
        d.delivery_date,
        d.time_window,
        d.notes,
        d.packer_id,
        d.driver_id,
        d.vehicle_id,
        d.trailer_id,
        ctx.user!.id,
        resolveCustomerId(ctx.body, d),
      );
      run('UPDATE orders SET number = ? WHERE id = ?', nextNumber(created.id), created.id);
      saveItems(created.id, items.map((x) => ({ ...x, id: null })));
      return created.id;
    });
    ctx.status = 201;
    return { order: getOrder(ctx.user!, id), warnings: conflictWarnings(id) };
  });

  r.put('/orders/:id', admin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    if (!get('SELECT id FROM orders WHERE id = ?', id)) throw new HttpError(404, 'Auftrag nicht gefunden');
    const d = parseOrder(ctx.body);
    const items = parseItems(ctx.body.items ?? []);
    tx(() => {
      run(
        `UPDATE orders SET customer_name = ?, address = ?, postal_code = ?, city = ?, phone = ?, delivery_date = ?,
                time_window = ?, notes = ?, packer_id = ?, driver_id = ?, vehicle_id = ?, trailer_id = ?, customer_id = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
        d.customer_name,
        d.address,
        d.postal_code,
        d.city,
        d.phone,
        d.delivery_date,
        d.time_window,
        d.notes,
        d.packer_id,
        d.driver_id,
        d.vehicle_id,
        d.trailer_id,
        resolveCustomerId(ctx.body, d),
        id,
      );
      saveItems(id, items);
    });
    return { order: getOrder(ctx.user!, id), warnings: conflictWarnings(id) };
  });

  r.post('/orders/:id/status', admin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const status = oneOf(ctx.body.status, ORDER_STATUSES, 'Status');
    if (!get('SELECT id FROM orders WHERE id = ?', id)) throw new HttpError(404, 'Auftrag nicht gefunden');
    run("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?", status, id);
    return { order: getOrder(ctx.user!, id), warnings: conflictWarnings(id) };
  });

  r.post('/orders/:id/duplicate', admin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const src = get<any>('SELECT * FROM orders WHERE id = ?', id);
    if (!src) throw new HttpError(404, 'Auftrag nicht gefunden');
    const newId = tx(() => {
      const created = run(
        `INSERT INTO orders (customer_name, address, postal_code, city, phone, time_window, notes, created_by, customer_id)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        src.customer_name,
        src.address,
        src.postal_code,
        src.city,
        src.phone,
        src.time_window,
        src.notes,
        ctx.user!.id,
        src.customer_id,
      );
      run('UPDATE orders SET number = ? WHERE id = ?', nextNumber(created.id), created.id);
      run(
        `INSERT INTO order_items (order_id, product_id, name, quantity, unit, packaging, deposit_rule_id,
                                  deposit_override_cents, deposit_cents, note, position)
         SELECT ?, product_id, name, quantity, unit, packaging, deposit_rule_id,
                deposit_override_cents, deposit_cents, note, position
           FROM order_items WHERE order_id = ?`,
        created.id,
        id,
      );
      return created.id;
    });
    ctx.status = 201;
    return { order: getOrder(ctx.user!, newId), warnings: [] };
  });

  r.delete('/orders/:id', admin, (ctx) => {
    run('DELETE FROM orders WHERE id = ?', reqId(ctx.params.id, 'ID'));
  });

  r.get('/dashboard', admin, (ctx) => {
    const today = todayStr();
    const count = (status: string): number =>
      all<{ n: number }>('SELECT COUNT(*) AS n FROM orders WHERE status = ?', status)[0].n;
    const todayOrders = queryOrders(
      ctx.user!,
      "o.delivery_date = ? AND o.status <> 'storniert'",
      [today],
    );
    const upcoming = all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM orders WHERE delivery_date > ? AND delivery_date <= ? AND status NOT IN ('storniert','geliefert')",
      today,
      addDays(today, 7),
    )[0].n;
    const onRoute = queryOrders(ctx.user!, "o.status = 'unterwegs'", []);
    const fleet = fleetOverview();
    return {
      today,
      counts: {
        neu: count('neu'),
        packen: count('packen'),
        gepackt: count('gepackt'),
        unterwegs: count('unterwegs'),
        today: todayOrders.length,
        upcoming_7_days: upcoming,
      },
      today_orders: todayOrders,
      on_route: onRoute,
      fleet: {
        vehicles_total: fleet.vehicles.length,
        vehicles_on_route: fleet.vehicles.filter((v) => v.state === 'unterwegs').length,
        trailers_total: fleet.trailers.length,
        trailers_on_route: fleet.trailers.filter((t) => t.state === 'unterwegs').length,
        in_workshop:
          fleet.vehicles.filter((v) => v.state === 'werkstatt').length +
          fleet.trailers.filter((t) => t.state === 'werkstatt').length,
      },
    };
  });
}
