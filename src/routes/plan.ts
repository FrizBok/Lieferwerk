import { all, get, run, tx } from '../db.ts';
import { requireRole } from '../auth.ts';
import { hasRoleSql } from '../lib/roles.ts';
import { queryOrders } from '../lib/orders.ts';
import { todayStr } from '../lib/util.ts';
import { bad, HttpError, optDate, optId, reqId } from '../lib/validate.ts';
import type { Router } from '../lib/web.ts';

const admin = requireRole('admin');

/** Reihenfolge innerhalb einer Tour: eingetragene Stopp-Nummer, dann Zeitfenster, dann ID. */
export function stopSort(a: any, b: any): number {
  const sa = a.stop_order > 0 ? a.stop_order : 1e9;
  const sb = b.stop_order > 0 ? b.stop_order : 1e9;
  return sa - sb || String(a.time_window ?? '').localeCompare(String(b.time_window ?? '')) || a.id - b.id;
}

function ref(table: 'users' | 'vehicles' | 'trailers', id: number | null, extra = ''): number | null {
  if (id === null) return null;
  if (!get(`SELECT id FROM ${table} WHERE id = ? ${extra}`, id)) bad('Eintrag nicht gefunden');
  return id;
}
const driverCond = `AND ${hasRoleSql('driver')} AND active = 1`;

/** Hinweise je Auftrag: Werkstatt, Fahrzeug/Anhänger von mehreren Fahrern am selben Tag. */
function warningsFor(orders: any[]): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  const add = (id: number, msg: string) => (out[id] ??= []).push(msg);
  for (const [col, plateKey, label] of [['vehicle_id', 'vehicle_plate', 'Fahrzeug'], ['trailer_id', 'trailer_plate', 'Anhänger']] as const) {
    const groups = new Map<number, any[]>();
    for (const o of orders) if (o[col] !== null && !['geliefert', 'storniert'].includes(o.status)) (groups.get(o[col]) ?? groups.set(o[col], []).get(o[col])!).push(o);
    for (const list of groups.values()) {
      const drivers = new Set(list.map((o) => o.driver_id ?? 'keiner'));
      if (drivers.size > 1) for (const o of list) add(o.id, `${label} ${o[plateKey]} ist am selben Tag bei mehreren Fahrern eingeplant.`);
    }
  }
  const bad_ = new Set(all<any>("SELECT id FROM vehicles WHERE status = 'werkstatt'").map((x) => 'v' + x.id));
  for (const x of all<any>("SELECT id FROM trailers WHERE status = 'werkstatt'")) bad_.add('t' + x.id);
  for (const o of orders) {
    if (o.vehicle_id !== null && bad_.has('v' + o.vehicle_id)) add(o.id, `Fahrzeug ${o.vehicle_plate} ist in der Werkstatt.`);
    if (o.trailer_id !== null && bad_.has('t' + o.trailer_id)) add(o.id, `Anhänger ${o.trailer_plate} ist in der Werkstatt.`);
  }
  return out;
}

export function register(r: Router): void {
  r.get('/plan', admin, (ctx) => {
    const date = optDate(ctx.query.get('date') || todayStr(), 'Datum') ?? todayStr();
    const orders = queryOrders(ctx.user!, "o.delivery_date = ? AND o.status <> 'storniert'", [date]).sort(stopSort);
    const undated = queryOrders(ctx.user!, "o.delivery_date IS NULL AND o.status IN ('neu','packen','gepackt')", []);
    return {
      date,
      orders,
      undated,
      warnings: warningsFor(orders),
      drivers: all(`SELECT id, name FROM users WHERE 1=1 ${driverCond} ORDER BY name`),
      vehicles: all('SELECT id, plate, name, status FROM vehicles ORDER BY plate'),
      trailers: all('SELECT id, plate, name, status FROM trailers ORDER BY plate'),
    };
  });

  /** Einzelnen Auftrag umplanen: Fahrer, Fahrzeug, Anhänger, Datum, Position in der Tour. */
  r.put('/plan/orders/:id', admin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const o = get<any>('SELECT * FROM orders WHERE id = ?', id);
    if (!o) throw new HttpError(404, 'Auftrag nicht gefunden');
    const b = ctx.body;
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    if ('driver_id' in b) { sets.push('driver_id = ?'); vals.push(ref('users', optId(b.driver_id, 'Fahrer'), driverCond)); }
    if ('vehicle_id' in b) { sets.push('vehicle_id = ?'); vals.push(ref('vehicles', optId(b.vehicle_id, 'Fahrzeug'))); }
    if ('trailer_id' in b) { sets.push('trailer_id = ?'); vals.push(ref('trailers', optId(b.trailer_id, 'Anhänger'))); }
    if ('delivery_date' in b) { sets.push('delivery_date = ?'); vals.push(optDate(b.delivery_date, 'Datum')); }
    if (!sets.length) bad('Nichts zu ändern');
    if ('driver_id' in b || 'delivery_date' in b) sets.push('stop_order = 0');
    run(`UPDATE orders SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...vals, id);
  });

  /** Reihenfolge einer Tour speichern: ids in gewünschter Reihenfolge. */
  r.post('/plan/reorder', admin, (ctx) => {
    const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids.map((x: unknown) => reqId(x, 'ID')) : bad('ids fehlen');
    tx(() => ids.forEach((id: number, i: number) => run('UPDATE orders SET stop_order = ? WHERE id = ?', i + 1, id)));
  });

  /** Fahrzeug/Anhänger für alle Aufträge eines Fahrers an einem Tag setzen. */
  r.post('/plan/tour', admin, (ctx) => {
    const date = optDate(ctx.body.date, 'Datum');
    if (!date) bad('Datum fehlt');
    const driver = optId(ctx.body.driver_id, 'Fahrer');
    const sets: string[] = [];
    const vals: (number | null)[] = [];
    if ('vehicle_id' in ctx.body) { sets.push('vehicle_id = ?'); vals.push(ref('vehicles', optId(ctx.body.vehicle_id, 'Fahrzeug'))); }
    if ('trailer_id' in ctx.body) { sets.push('trailer_id = ?'); vals.push(ref('trailers', optId(ctx.body.trailer_id, 'Anhänger'))); }
    if (!sets.length) bad('Nichts zu ändern');
    const res = run(
      `UPDATE orders SET ${sets.join(', ')}, updated_at = datetime('now')
        WHERE delivery_date = ? AND driver_id IS ? AND status NOT IN ('geliefert','storniert')`,
      ...vals, date, driver,
    );
    return { changed: res.changes };
  });
}
