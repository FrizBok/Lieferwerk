import { all, get, run } from '../db.ts';
import { requireRole } from '../auth.ts';
import { queryOrders } from '../lib/orders.ts';
import { bad, HttpError, optStr, reqId, reqStr } from '../lib/validate.ts';
import type { Router } from '../lib/web.ts';

const admin = requireRole('admin');

const STATS = `
  c.*,
  (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS order_count,
  (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'geliefert') AS delivered_count,
  (SELECT MAX(o.delivery_date) FROM orders o WHERE o.customer_id = c.id AND o.status = 'geliefert') AS last_delivery,
  COALESCE((SELECT SUM(i.deposit_cents) FROM order_items i JOIN orders o ON o.id = i.order_id
             WHERE o.customer_id = c.id AND o.status <> 'storniert'), 0) AS deposit_total_cents`;

function parse(body: any) {
  return {
    name: reqStr(body.name, 'Name', 120),
    address: optStr(body.address, 'Adresse', 200),
    postal_code: optStr(body.postal_code, 'PLZ', 10),
    city: optStr(body.city, 'Ort', 80),
    phone: optStr(body.phone, 'Telefon', 40),
    notes: optStr(body.notes, 'Notizen', 2000),
  };
}

function duplicate(d: { name: string; address: string | null; postal_code: string | null }, exceptId = 0): boolean {
  return !!get(
    `SELECT id FROM customers WHERE id <> ? AND lower(trim(name)) = lower(trim(?)) AND lower(trim(coalesce(address,''))) = lower(trim(?))
        AND lower(trim(coalesce(postal_code,''))) = lower(trim(?))`,
    exceptId, d.name, d.address ?? '', d.postal_code ?? '',
  );
}

export function register(r: Router): void {
  r.get('/customers', admin, (ctx) => {
    const q = (ctx.query.get('q') ?? '').trim();
    const where = q ? 'WHERE c.name LIKE ? OR c.address LIKE ? OR c.city LIKE ? OR c.phone LIKE ?' : '';
    const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [];
    return all(`SELECT ${STATS} FROM customers c ${where} ORDER BY lower(c.name)`, ...params);
  });

  r.get('/customers/:id', admin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const customer = get(`SELECT ${STATS} FROM customers c WHERE c.id = ?`, id);
    if (!customer) throw new HttpError(404, 'Kunde nicht gefunden');
    const orders = queryOrders(ctx.user!, 'o.customer_id = ?', [id], { newestFirst: true });
    return { customer, orders };
  });

  r.post('/customers', admin, (ctx) => {
    const d = parse(ctx.body);
    if (duplicate(d)) throw new HttpError(409, 'Diesen Kunden (gleicher Name und Adresse) gibt es schon.');
    const { id } = run(
      'INSERT INTO customers (name, address, postal_code, city, phone, notes) VALUES (?,?,?,?,?,?)',
      d.name, d.address, d.postal_code, d.city, d.phone, d.notes,
    );
    ctx.status = 201;
    return get(`SELECT ${STATS} FROM customers c WHERE c.id = ?`, id);
  });

  r.put('/customers/:id', admin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    if (!get('SELECT id FROM customers WHERE id = ?', id)) throw new HttpError(404, 'Kunde nicht gefunden');
    const d = parse(ctx.body);
    if (duplicate(d, id)) throw new HttpError(409, 'Einen Kunden mit gleichem Namen und gleicher Adresse gibt es schon.');
    run('UPDATE customers SET name = ?, address = ?, postal_code = ?, city = ?, phone = ?, notes = ? WHERE id = ?',
      d.name, d.address, d.postal_code, d.city, d.phone, d.notes, id);
    return get(`SELECT ${STATS} FROM customers c WHERE c.id = ?`, id);
  });

  r.delete('/customers/:id', admin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const n = get<any>('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?', id)!.n;
    if (n > 0) bad('Dieser Kunde hat Aufträge und kann nicht gelöscht werden.');
    run('DELETE FROM customers WHERE id = ?', id);
  });
}
