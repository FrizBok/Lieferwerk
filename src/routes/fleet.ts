import { all, get, run } from '../db.ts';
import { requireRole } from '../auth.ts';
import { todayStr } from '../lib/util.ts';
import { HttpError, oneOf, optDate, optStr, reqId, reqStr } from '../lib/validate.ts';
import type { Router } from '../lib/web.ts';

const admin = requireRole('admin');

const VEHICLE_TYPES = ['transporter', 'lkw', 'pkw', 'sonstiges'] as const;
const TRAILER_TYPES = ['standard', 'kuehl', 'getraenke', 'sonstiges'] as const;
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
  const state = row.status === 'werkstatt' ? 'werkstatt' : current ? 'unterwegs' : 'verfuegbar';
  return { ...row, state, current: current ?? null, upcoming, inspection_days_left: inspectionDays };
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
  const parse = (body: any) => ({
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
      `INSERT INTO ${table} (plate, name, type, status, capacity, inspection_date, notes) VALUES (?,?,?,?,?,?,?)`,
      d.plate,
      d.name,
      d.type,
      d.status,
      d.capacity,
      d.inspection_date,
      d.notes,
    );
    ctx.status = 201;
    return enrich(get(`SELECT * FROM ${table} WHERE id = ?`, id), col);
  });

  r.put(`/${base}/:id`, admin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    if (!get(`SELECT id FROM ${table} WHERE id = ?`, id)) throw new HttpError(404, `${label} nicht gefunden`);
    const d = parse(ctx.body);
    run(
      `UPDATE ${table} SET plate = ?, name = ?, type = ?, status = ?, capacity = ?, inspection_date = ?, notes = ? WHERE id = ?`,
      d.plate,
      d.name,
      d.type,
      d.status,
      d.capacity,
      d.inspection_date,
      d.notes,
      id,
    );
    return enrich(get(`SELECT * FROM ${table} WHERE id = ?`, id), col);
  });

  r.delete(`/${base}/:id`, admin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const busy = get(`SELECT id FROM orders WHERE ${col} = ? AND status = 'unterwegs'`, id);
    if (busy) throw new HttpError(409, `${label} ist gerade unterwegs und kann nicht gelöscht werden`);
    run(`DELETE FROM ${table} WHERE id = ?`, id);
  });
}

export function register(r: Router): void {
  r.get('/fleet', admin, () => fleetOverview());
  registerCrud(r, 'vehicles', 'vehicles', 'vehicle_id', VEHICLE_TYPES, 'Fahrzeug');
  registerCrud(r, 'trailers', 'trailers', 'trailer_id', TRAILER_TYPES, 'Anhänger');
}
