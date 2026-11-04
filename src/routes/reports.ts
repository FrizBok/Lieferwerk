import { all, get } from '../db.ts';
import { requireRole } from '../auth.ts';
import { addDays, todayStr } from '../lib/util.ts';
import { bad, optDate } from '../lib/validate.ts';
import type { Router } from '../lib/web.ts';

const admin = requireRole('admin');

/** Auswertung fuer einen Zeitraum (nach Lieferdatum). Storniertes zaehlt nicht mit. */
export function report(from: string, to: string): any {
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (!(days >= 0)) bad('Das Enddatum liegt vor dem Startdatum');
  if (days > 730) bad('Der Zeitraum darf höchstens 2 Jahre umfassen');
  const P = [from, to];
  const range = "o.delivery_date BETWEEN ? AND ? AND o.status <> 'storniert'";

  const k = get<any>(
    `SELECT COUNT(*) AS orders,
            SUM(o.status = 'geliefert') AS delivered,
            SUM(o.status IN ('neu','packen','gepackt','unterwegs')) AS open_orders
       FROM orders o WHERE ${range}`, ...P);
  const cancelled = get<any>("SELECT COUNT(*) AS n FROM orders o WHERE o.delivery_date BETWEEN ? AND ? AND o.status = 'storniert'", ...P).n;
  const items = get<any>(`SELECT COUNT(*) AS n, COALESCE(SUM(i.deposit_cents),0) AS dep
       FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${range} AND i.item_status <> 'nicht_lieferbar'`, ...P);
  const issues = get<any>(`SELECT COUNT(*) AS n FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${range} AND i.item_status <> 'normal'`, ...P).n;

  const perDay = new Map<string, any>(
    all<any>(`SELECT o.delivery_date AS d, COUNT(*) AS n, SUM(o.status = 'geliefert') AS delivered FROM orders o WHERE ${range} GROUP BY o.delivery_date`, ...P)
      .map((r) => [r.d, r]),
  );
  const by_day: { date: string; orders: number; delivered: number }[] = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(from, i);
    const r = perDay.get(d);
    by_day.push({ date: d, orders: r?.n ?? 0, delivered: r?.delivered ?? 0 });
  }

  const top_customers = all(
    `SELECT o.customer_name AS name, COUNT(DISTINCT o.id) AS orders,
            (SELECT COUNT(*) FROM order_items i WHERE i.order_id IN (SELECT id FROM orders x WHERE x.customer_name = o.customer_name AND x.delivery_date BETWEEN ? AND ? AND x.status <> 'storniert')) AS items
       FROM orders o WHERE ${range} GROUP BY o.customer_name ORDER BY orders DESC, items DESC, name LIMIT 10`, ...P, ...P);

  const by_driver = all(
    `SELECT COALESCE(u.name, 'Nicht zugewiesen') AS name, COUNT(*) AS orders, SUM(o.status = 'geliefert') AS delivered,
            COUNT(DISTINCT o.delivery_date) AS tour_days
       FROM orders o LEFT JOIN users u ON u.id = o.driver_id WHERE ${range} GROUP BY o.driver_id ORDER BY orders DESC, name`, ...P);

  const by_vehicle = all(
    `SELECT v.plate, COALESCE(v.name, '') AS name, COUNT(*) AS orders, SUM(o.status = 'geliefert') AS delivered
       FROM orders o JOIN vehicles v ON v.id = o.vehicle_id WHERE ${range} GROUP BY v.id ORDER BY orders DESC, v.plate`, ...P);

  const top_products = all(
    `SELECT CASE WHEN i.item_status = 'ersatz' THEN i.repl_name ELSE i.name END AS name,
            CASE WHEN i.item_status = 'ersatz' THEN COALESCE(i.repl_unit, i.unit) ELSE i.unit END AS unit,
            COUNT(*) AS lines,
            SUM(CASE WHEN i.item_status = 'ersatz' THEN COALESCE(i.repl_qty, i.quantity) ELSE i.quantity END) AS qty
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE ${range} AND i.item_status <> 'nicht_lieferbar'
      GROUP BY lower(name), unit ORDER BY lines DESC, qty DESC, name LIMIT 10`, ...P);

  const fleet_costs = all(
    `SELECT CASE l.kind WHEN 'vehicles' THEN COALESCE((SELECT plate FROM vehicles WHERE id = l.ref_id), '?')
                        ELSE COALESCE((SELECT plate FROM trailers WHERE id = l.ref_id), '?') END AS plate,
            l.kind, SUM(COALESCE(l.cost_cents, 0)) AS cost_cents,
            SUM(CASE WHEN l.type = 'tanken' THEN COALESCE(l.cost_cents, 0) ELSE 0 END) AS fuel_cents,
            SUM(CASE WHEN l.type IN ('service','reparatur','hu','reifen') THEN COALESCE(l.cost_cents, 0) ELSE 0 END) AS upkeep_cents
       FROM fleet_logs l WHERE l.log_date BETWEEN ? AND ? GROUP BY l.kind, l.ref_id ORDER BY cost_cents DESC`, ...P);

  return {
    from, to,
    kpis: {
      orders: k.orders ?? 0,
      delivered: k.delivered ?? 0,
      open: k.open_orders ?? 0,
      cancelled,
      items: items.n,
      deposit_cents: items.dep,
      issues,
      fleet_cost_cents: fleet_costs.reduce((a: number, r: any) => a + r.cost_cents, 0),
      avg_per_week: Math.round(((k.orders ?? 0) / (days + 1)) * 70) / 10,
    },
    by_day, top_customers, by_driver, by_vehicle, top_products, fleet_costs,
  };
}

export function register(r: Router): void {
  r.get('/reports', admin, (ctx) => {
    const to = optDate(ctx.query.get('to'), 'Bis') ?? todayStr();
    const from = optDate(ctx.query.get('from'), 'Von') ?? addDays(to, -29);
    return report(from, to);
  });
}
