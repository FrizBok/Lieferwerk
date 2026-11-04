import { all, get, run } from '../db.ts';
import { requireRole } from '../auth.ts';
import { todayStr } from '../lib/util.ts';
import { bad, HttpError, oneOf, optDate, optInt, optStr, reqId, reqNum, reqStr } from '../lib/validate.ts';
import type { Router } from '../lib/web.ts';

const admin = requireRole('admin');

const VEHICLE_TYPES = ['transporter', 'lkw', 'pkw', 'sonstiges'] as const;
const TRAILER_TYPES = ['standard', 'kuehl', 'getraenke', 'sonstiges'] as const;
export const LOG_TYPES = ['tanken', 'service', 'reparatur', 'hu', 'reifen', 'sonstiges'] as const;
const STATES = ['verfuegbar', 'werkstatt'] as const;

type Table = 'vehicles' | 'trailers';
type Column = 'vehicle_id' | 'trailer_id';

/** Ergaenzt eine Fuhrpark-Zeile um aktuellen Einsatz und naechste geplante Auftraege. */
function enrich(row: any, col: Column): any {
  const current = get(
    `SELECT o.id, o.number, o.customer_name, o.city, o.delivery_date, d.name AS driver_name
       FROM orders o LEFT JOIN users d ON d.id = o.driver_id
      WHERE o.${col} = ? AND o.status = 'unterwegs' ORDER BY o.id LIMIT 1`,
    row.id,
  );
  const upcoming = all(
    `SELECT o.id, o.number, o.customer_name, o.city, o.delivery_date, o.status
       FROM orders o
      WHERE o.${col} = ? AND o.status IN ('neu','packen','gepackt')
        AND (o.delivery_date IS NULL OR o.delivery_date >= ?)
      ORDER BY (o.delivery_date IS NULL), o.delivery_date, o.id LIMIT 3`,
    row.id,
    todayStr(),
  );
  let inspectionDays: number | null = null;
  if (row.inspection_date) {
    const [y, m, d] = (row.inspection_date as string).split('-').map(Number);
    const [ty, tm, td] = todayStr().split('-').map(Number);
    inspectionDays = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
  }
  let serviceDays: number | null = null;
  if (row.next_service_date) {
    const [y, m, d] = (row.next_service_date as string).split('-').map(Number);
    const [ty, tm, td] = todayStr().split('-').map(Number);
    serviceDays = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
  }
  const serviceKmLeft = row.next_service_km != null && row.odometer_km != null ? row.next_service_km - row.odometer_km : null;
  const state = row.status === 'werkstatt' ? 'werkstatt' : current ? 'unterwegs' : 'verfuegbar';
  return { ...row, state, current: current ?? null, upcoming, inspection_days_left: inspectionDays, service_days_left: serviceDays, service_km_left: serviceKmLeft };
}

export function fleetOverview(): { vehicles: any[]; trailers: any[] } {
  return {
    vehicles: all('SELECT * FROM vehicles ORDER BY plate').map((v) => enrich(v, 'vehicle_id')),
    trailers: all('SELECT * FROM trailers ORDER BY plate').map((t) => enrich(t, 'trailer_id')),
  };
}

function registerCrud(
  r: Router,
  base: string,
  table: Table,
  col: Column,
  types: readonly string[],
  label: string,
): void {
  const parse = (body: any, old?: any) => ({
    next_service_date: 'next_service_date' in body ? optDate(body.next_service_date, 'Nächster Service (Datum)') : (old?.next_service_date ?? null),
    next_service_km: 'next_service_km' in body ? optInt(body.next_service_km, 'Nächster Service (km)', 0, 5_000_000) : (old?.next_service_km ?? null),
    odometer_km: 'odometer_km' in body ? optInt(body.odometer_km, 'Kilometerstand', 0, 5_000_000) : (old?.odometer_km ?? null),
    plate: reqStr(body.plate, 'Kennzeichen', 20),
    name: optStr(body.name, 'Bezeichnung', 80),
    type: oneOf(body.type ?? types[0], types, 'Typ'),
    status: oneOf(body.status ?? 'verfuegbar', STATES, 'Status'),
    capacity: optStr(body.capacity, 'Ladekapazität', 60),
    inspection_date: optDate(body.inspection_date, 'TÜV/HU-Datum'),
    notes: optStr(body.notes, 'Notiz', 1000),
  });

  r.post(`/${base}`, admin, (ctx) => {
    const d = parse(ctx.body);
    const { id } = run(
      `INSERT INTO ${table} (plate, name, type, status, capacity, inspection_date, notes, next_service_date, next_service_km, odometer_km) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      d.plate,
      d.name,
      d.type,
      d.status,
      d.capacity,
      d.inspection_date,
      d.notes,
      d.next_service_date,
      d.next_service_km,
      d.odometer_km,
    );
    ctx.status = 201;
    return enrich(get(`SELECT * FROM ${table} WHERE id = ?`, id), col);
  });

  r.put(`/${base}/:id`, admin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const old = get<any>(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!old) throw new HttpError(404, `${label} nicht gefunden`);
    const d = parse(ctx.body, old);
    run(
      `UPDATE ${table} SET plate = ?, name = ?, type = ?, status = ?, capacity = ?, inspection_date = ?, notes = ?,
              next_service_date = ?, next_service_km = ?, odometer_km = ? WHERE id = ?`,
      d.plate,
      d.name,
      d.type,
      d.status,
      d.capacity,
      d.inspection_date,
      d.notes,
      d.next_service_date,
      d.next_service_km,
      d.odometer_km,
      id,
    );
    return enrich(get(`SELECT * FROM ${table} WHERE id = ?`, id), col);
  });

  r.delete(`/${base}/:id`, admin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const busy = get(`SELECT id FROM orders WHERE ${col} = ? AND status = 'unterwegs'`, id);
    if (busy) throw new HttpError(409, `${label} ist gerade unterwegs und kann nicht gelöscht werden`);
    run(`DELETE FROM ${table} WHERE id = ?`, id);
    run('DELETE FROM fleet_logs WHERE kind = ? AND ref_id = ?', table, id);
  });
}

function akte(kind: Table, id: number): any {
  const table = kind;
  const col: Column = kind === 'vehicles' ? 'vehicle_id' : 'trailer_id';
  const row = get<any>(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'Eintrag nicht gefunden');
  const logs = all<any>(
    'SELECT * FROM fleet_logs WHERE kind = ? AND ref_id = ? ORDER BY log_date DESC, id DESC', kind, id,
  );
  const year = todayStr().slice(0, 4);
  const sum = (f: (l: any) => boolean) => logs.filter(f).reduce((a, l) => a + (l.cost_cents || 0), 0);
  // Verbrauch: alle Tankungen mit km-Stand; die erste Tankung liefert nur den Startwert
  const fuel = logs.filter((l) => l.type === 'tanken' && l.km != null && l.liters).sort((a, b) => a.km - b.km);
  let avg: number | null = null;
  if (fuel.length >= 2) {
    const km = fuel[fuel.length - 1].km - fuel[0].km;
    const liters = fuel.slice(1).reduce((a, l) => a + l.liters, 0);
    if (km > 0) avg = Math.round((liters / km) * 1000) / 10;
  }
  const trips = get<any>(`SELECT COUNT(*) AS n FROM orders WHERE ${col} = ? AND status = 'geliefert'`, id).n;
  const recent = all(
    `SELECT id, number, customer_name, city, delivery_date FROM orders WHERE ${col} = ? AND status = 'geliefert'
      ORDER BY delivery_date DESC, id DESC LIMIT 5`, id);
  return {
    kind,
    item: enrich(row, col),
    logs,
    recent_orders: recent,
    stats: {
      total_cost_cents: sum(() => true),
      year_cost_cents: sum((l) => String(l.log_date).startsWith(year)),
      fuel_cost_cents: sum((l) => l.type === 'tanken'),
      fuel_liters: Math.round(logs.filter((l) => l.type === 'tanken').reduce((a, l) => a + (l.liters || 0), 0) * 10) / 10,
      avg_l_100km: avg,
      deliveries: trips,
    },
  };
}

function parseLog(body: any): any {
  return {
    log_date: optDate(body.log_date, 'Datum') ?? bad('Datum fehlt'),
    type: oneOf(body.type ?? 'sonstiges', LOG_TYPES, 'Art'),
    km: optInt(body.km, 'Kilometerstand', 0, 5_000_000),
    cost_cents: body.cost_cents == null || body.cost_cents === '' ? null : Math.round(reqNum(body.cost_cents, 'Kosten', 0, 100_000_000)),
    liters: body.liters == null || body.liters === '' ? null : reqNum(body.liters, 'Liter', 0, 100_000),
    note: optStr(body.note, 'Notiz', 500),
  };
}

function bumpOdometer(kind: Table, id: number, km: number | null): void {
  if (km == null) return;
  run(`UPDATE ${kind} SET odometer_km = ? WHERE id = ? AND (odometer_km IS NULL OR odometer_km < ?)`, km, id, km);
}

function registerAkte(r: Router): void {
  const kindOf = (v: string): Table => (v === 'vehicles' || v === 'trailers' ? v : bad('Unbekannte Art'));
  r.get('/fleet/:kind/:id/akte', admin, (ctx) => akte(kindOf(ctx.params.kind), reqId(ctx.params.id, 'ID')));

  r.post('/fleet/:kind/:id/logs', admin, (ctx) => {
    const kind = kindOf(ctx.params.kind);
    const id = reqId(ctx.params.id, 'ID');
    if (!get(`SELECT id FROM ${kind} WHERE id = ?`, id)) throw new HttpError(404, 'Eintrag nicht gefunden');
    const d = parseLog(ctx.body);
    run(
      'INSERT INTO fleet_logs (kind, ref_id, log_date, type, km, cost_cents, liters, note) VALUES (?,?,?,?,?,?,?,?)',
      kind, id, d.log_date, d.type, d.km, d.cost_cents, d.liters, d.note,
    );
    bumpOdometer(kind, id, d.km);
    ctx.status = 201;
    return akte(kind, id);
  });

  r.put('/fleet/logs/:id', admin, (ctx) => {
    const lid = reqId(ctx.params.id, 'ID');
    const old = get<any>('SELECT * FROM fleet_logs WHERE id = ?', lid);
    if (!old) throw new HttpError(404, 'Eintrag nicht gefunden');
    const d = parseLog(ctx.body);
    run('UPDATE fleet_logs SET log_date = ?, type = ?, km = ?, cost_cents = ?, liters = ?, note = ? WHERE id = ?',
      d.log_date, d.type, d.km, d.cost_cents, d.liters, d.note, lid);
    bumpOdometer(old.kind, old.ref_id, d.km);
    return akte(old.kind, old.ref_id);
  });

  r.delete('/fleet/logs/:id', admin, (ctx) => {
    const lid = reqId(ctx.params.id, 'ID');
    const old = get<any>('SELECT * FROM fleet_logs WHERE id = ?', lid);
    if (!old) throw new HttpError(404, 'Eintrag nicht gefunden');
    run('DELETE FROM fleet_logs WHERE id = ?', lid);
    return akte(old.kind, old.ref_id);
  });
}

export function register(r: Router): void {
  r.get('/fleet', admin, () => fleetOverview());
  registerAkte(r);
  registerCrud(r, 'vehicles', 'vehicles', 'vehicle_id', VEHICLE_TYPES, 'Fahrzeug');
  registerCrud(r, 'trailers', 'trailers', 'trailer_id', TRAILER_TYPES, 'Anhänger');
}
