import { randomBytes } from 'node:crypto';
import { all, get, run, tx } from '../db.ts';
import { hashPassword, requireRole } from '../auth.ts';
import { calcDepositCents } from '../lib/deposit.ts';
import { findOrCreateCustomer } from '../lib/customers.ts';
import { rolesToCsv } from '../lib/roles.ts';
import { addDays, todayStr } from '../lib/util.ts';
import { HttpError } from '../lib/validate.ts';
import type { Router } from '../lib/web.ts';
import type { Role } from '../types.ts';

const admin = requireRole('admin');

interface DemoItem {
  name: string;
  qty: number;
  unit?: string;
  pack?: 'einzeln' | 'kasten';
}
interface DemoOrder {
  customer: string;
  address: string;
  plz: string;
  city: string;
  phone: string;
  day: number; // Tage relativ zu heute
  window: string;
  status: 'neu' | 'packen' | 'gepackt' | 'unterwegs' | 'geliefert' | 'storniert';
  packer?: number; // Index in DEMO_USERS
  driver?: number;
  vehicle?: number;
  trailer?: number;
  notes?: string;
  items: DemoItem[];
}

const DEMO_USERS: { username: string; name: string; roles: Role[] }[] = [
  { username: 'demo.paula', name: 'Paula Packer (Demo)', roles: ['packer'] },
  { username: 'demo.dirk', name: 'Dirk Fahrer (Demo)', roles: ['driver'] },
  { username: 'demo.pauli', name: 'Pauli Packer & Fahrer (Demo)', roles: ['packer', 'driver'] },
];

const DEMO_VEHICLES = [
  { plate: 'N-LW 101', name: 'Sprinter weiß', type: 'transporter', status: 'verfuegbar', capacity: '1.200 kg', insp: 200 },
  { plate: 'N-LW 202', name: 'Kühl-LKW', type: 'lkw', status: 'verfuegbar', capacity: '3.500 kg', insp: 25 },
  { plate: 'N-LW 303', name: 'Caddy', type: 'pkw', status: 'werkstatt', capacity: '600 kg', insp: -10 },
];
const DEMO_TRAILERS = [
  { plate: 'N-AH 11', name: 'Getränkeanhänger', type: 'getraenke', status: 'verfuegbar', capacity: '1.500 kg', insp: 300 },
  { plate: 'N-AH 12', name: 'Kühlanhänger', type: 'kuehl', status: 'verfuegbar', capacity: '1.000 kg', insp: 90 },
  { plate: 'N-AH 13', name: 'Standard-Anhänger', type: 'standard', status: 'werkstatt', capacity: '750 kg', insp: 15 },
];

const KISTE: DemoItem[] = [
  { name: 'Mineralwasser still 0,75 l', qty: 3, pack: 'kasten' },
  { name: 'Cola 1,0 l', qty: 2, pack: 'kasten' },
  { name: 'Milch 1 l', qty: 6 },
  { name: 'Brot', qty: 2 },
];

const DEMO_ORDERS: DemoOrder[] = [
  // --- Archiv (erledigt) ---
  { customer: 'Familie Müller', address: 'Lindenstraße 12', plz: '90402', city: 'Nürnberg', phone: '0911 123456', day: -21, window: '10–12 Uhr', status: 'geliefert', packer: 0, driver: 1, vehicle: 0, trailer: 0, items: KISTE },
  { customer: 'Bäckerei Schmidt', address: 'Marktplatz 3', plz: '90403', city: 'Nürnberg', phone: '0911 765432', day: -18, window: '07–08 Uhr', status: 'geliefert', packer: 2, driver: 2, vehicle: 0, trailer: 1, notes: 'Hintereingang, Klingel „Lieferung“', items: [{ name: 'Mehl (Demo)', qty: 20, unit: 'kg' }, { name: 'Milch 1 l', qty: 24 }, { name: 'Pils 0,5 l', qty: 2, pack: 'kasten' }] },
  { customer: 'Gasthaus Zum Löwen', address: 'Hauptstraße 45', plz: '90491', city: 'Nürnberg', phone: '0911 223344', day: -14, window: '14–16 Uhr', status: 'geliefert', packer: 0, driver: 1, vehicle: 1, trailer: 0, items: [{ name: 'Pils 0,5 l', qty: 10, pack: 'kasten' }, { name: 'Cola 1,0 l', qty: 4, pack: 'kasten' }, { name: 'Mineralwasser still 0,75 l', qty: 6, pack: 'kasten' }] },
  { customer: 'Familie Müller', address: 'Lindenstraße 12', plz: '90402', city: 'Nürnberg', phone: '0911 123456', day: -9, window: '16–18 Uhr', status: 'geliefert', packer: 2, driver: 1, vehicle: 0, trailer: 0, items: [{ name: 'Äpfel', qty: 5, unit: 'kg' }, { name: 'Nudeln 500 g', qty: 8 }, { name: 'Energy Drink Dose 0,25 l', qty: 12 }] },
  { customer: 'Kita Sonnenschein', address: 'Schulweg 7', plz: '90429', city: 'Fürth', phone: '0911 554433', day: -6, window: '09–10 Uhr', status: 'storniert', packer: 0, items: [{ name: 'Äpfel', qty: 10, unit: 'kg' }, { name: 'Milch 1 l', qty: 20 }], notes: 'Vom Kunden storniert' },
  { customer: 'Bäckerei Schmidt', address: 'Marktplatz 3', plz: '90403', city: 'Nürnberg', phone: '0911 765432', day: -3, window: '07–08 Uhr', status: 'geliefert', packer: 2, driver: 2, vehicle: 0, trailer: 1, items: [{ name: 'Milch 1 l', qty: 30 }, { name: 'Mineralwasser still 0,75 l', qty: 2, pack: 'kasten' }] },
  // --- Heute ---
  { customer: 'Autohaus Weber', address: 'Industriestraße 9', plz: '90411', city: 'Nürnberg', phone: '0911 889900', day: 0, window: '08–10 Uhr', status: 'unterwegs', packer: 0, driver: 1, vehicle: 1, trailer: 0, notes: 'Beim Pförtner melden', items: [{ name: 'Mineralwasser still 0,75 l', qty: 5, pack: 'kasten' }, { name: 'Cola 1,0 l', qty: 3, pack: 'kasten' }, { name: 'Brot', qty: 10 }] },
  { customer: 'Praxis Dr. Hahn', address: 'Ärztehaus, Gartenweg 2', plz: '90425', city: 'Nürnberg', phone: '0911 667788', day: 0, window: '11–12 Uhr', status: 'gepackt', packer: 2, driver: 2, vehicle: 0, trailer: 1, items: [{ name: 'Mineralwasser still 0,75 l', qty: 4, pack: 'kasten' }, { name: 'Äpfel', qty: 6, unit: 'kg' }] },
  { customer: 'Familie Yilmaz', address: 'Birkenweg 21', plz: '90455', city: 'Nürnberg', phone: '0171 2345678', day: 0, window: '14–16 Uhr', status: 'gepackt', packer: 0, driver: 1, items: KISTE },
  { customer: 'Gasthaus Zum Löwen', address: 'Hauptstraße 45', plz: '90491', city: 'Nürnberg', phone: '0911 223344', day: 0, window: '15–17 Uhr', status: 'packen', packer: 0, notes: 'Bier bitte kühl lagern', items: [{ name: 'Pils 0,5 l', qty: 6, pack: 'kasten' }, { name: 'Energy Drink Dose 0,25 l', qty: 24 }, { name: 'Nudeln 500 g', qty: 10 }, { name: 'Äpfel', qty: 4, unit: 'kg' }] },
  { customer: 'Seniorenheim Abendsonne', address: 'Parkallee 5', plz: '90408', city: 'Nürnberg', phone: '0911 998877', day: 0, window: '16–17 Uhr', status: 'neu', items: [{ name: 'Milch 1 l', qty: 24 }, { name: 'Brot', qty: 12 }, { name: 'Mineralwasser still 0,75 l', qty: 8, pack: 'kasten' }] },
  // --- Demnächst ---
  { customer: 'Familie Müller', address: 'Lindenstraße 12', plz: '90402', city: 'Nürnberg', phone: '0911 123456', day: 1, window: '10–12 Uhr', status: 'neu', packer: 2, driver: 1, vehicle: 0, items: KISTE },
  { customer: 'Vereinsheim FC Eintracht', address: 'Sportplatz 1', plz: '90480', city: 'Nürnberg', phone: '0911 445566', day: 2, window: '12–13 Uhr', status: 'neu', vehicle: 1, trailer: 0, notes: 'Grillfest – bitte pünktlich', items: [{ name: 'Pils 0,5 l', qty: 15, pack: 'kasten' }, { name: 'Cola 1,0 l', qty: 8, pack: 'kasten' }, { name: 'Mineralwasser still 0,75 l', qty: 10, pack: 'kasten' }, { name: 'Energy Drink Dose 0,25 l', qty: 48 }] },
];

export function register(r: Router): void {
  r.get('/demo-data', admin, () => ({
    exists: get<any>('SELECT COUNT(*) AS n FROM orders WHERE demo = 1')!.n > 0 || get<any>('SELECT COUNT(*) AS n FROM users WHERE demo = 1')!.n > 0,
    orders: get<any>('SELECT COUNT(*) AS n FROM orders WHERE demo = 1')!.n,
    vehicles: get<any>('SELECT COUNT(*) AS n FROM vehicles WHERE demo = 1')!.n,
    trailers: get<any>('SELECT COUNT(*) AS n FROM trailers WHERE demo = 1')!.n,
    users: get<any>('SELECT COUNT(*) AS n FROM users WHERE demo = 1')!.n,
    customers: get<any>('SELECT COUNT(*) AS n FROM customers WHERE demo = 1')!.n,
  }));

  r.post('/demo-data', admin, (ctx) => {
    if (get<any>('SELECT COUNT(*) AS n FROM orders WHERE demo = 1')!.n > 0) {
      throw new HttpError(409, 'Testdaten sind schon vorhanden. Bitte zuerst entfernen, dann neu erzeugen.');
    }
    const password = `demo-${randomBytes(4).toString('hex')}`;
    const hash = hashPassword(password);
    const today = todayStr();

    const counts = tx(() => {
      const userIds: number[] = [];
      for (const u of DEMO_USERS) {
        const existing = get<any>('SELECT id FROM users WHERE username = ?', u.username);
        if (existing) {
          userIds.push(existing.id);
          continue;
        }
        userIds.push(
          run(
            'INSERT INTO users (username, name, password_hash, role, roles, demo) VALUES (?,?,?,?,?,1)',
            u.username,
            u.name,
            hash,
            u.roles[0],
            rolesToCsv(u.roles),
          ).id,
        );
      }
      const vehicleIds = DEMO_VEHICLES.map((v) =>
        run(
          'INSERT INTO vehicles (plate, name, type, status, capacity, inspection_date, demo) VALUES (?,?,?,?,?,?,1)',
          v.plate, v.name, v.type, v.status, v.capacity, addDays(today, v.insp),
        ).id,
      );
      const trailerIds = DEMO_TRAILERS.map((t) =>
        run(
          'INSERT INTO trailers (plate, name, type, status, capacity, inspection_date, demo) VALUES (?,?,?,?,?,?,1)',
          t.plate, t.name, t.type, t.status, t.capacity, addDays(today, t.insp),
        ).id,
      );

      // Fahrzeugakte: Beispiel-Eintraege (Tanken, Service, Reparatur) fuer die ersten zwei Fahrzeuge
      vehicleIds.slice(0, 2).forEach((vid, vi) => {
        let km = 82_000 + vi * 31_000;
        const ins = (days: number, type: string, add: number, cost: number | null, liters: number | null, note: string) => {
          km += add;
          run('INSERT INTO fleet_logs (kind, ref_id, log_date, type, km, cost_cents, liters, note, demo) VALUES (?,?,?,?,?,?,?,?,1)',
            'vehicles', vid, addDays(today, days), type, km, cost, liters, note);
        };
        ins(-120, 'service', 0, 38900, null, 'Inspektion, Ölwechsel');
        ins(-100, 'tanken', 900, 10450, 62.4, 'Diesel');
        ins(-70, 'tanken', 1050, 11320, 66.1, 'Diesel');
        ins(-45, 'reifen', 400, 54000, null, 'Winterreifen montiert');
        ins(-30, 'tanken', 980, 10890, 64.0, 'Diesel');
        ins(-12, 'reparatur', 600, 21480, null, 'Bremsbeläge vorn');
        ins(-5, 'tanken', 700, 8120, 47.5, 'Diesel');
        run('UPDATE vehicles SET odometer_km = ?, next_service_km = ?, next_service_date = ? WHERE id = ?', km, km + (vi === 0 ? 800 : 9000), addDays(today, vi === 0 ? 20 : 150), vid);
      });

      let orderCount = 0;
      for (const o of DEMO_ORDERS) {
        const date = addDays(today, o.day);
        const stamp = `${addDays(today, Math.min(o.day, 0) - 1)} 08:00:00`;
        const orderId = run(
          `INSERT INTO orders (customer_name, address, postal_code, city, phone, delivery_date, time_window, status, notes,
                               packer_id, driver_id, vehicle_id, trailer_id, created_at, updated_at, customer_id, demo)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
          o.customer, o.address, o.plz, o.city, o.phone, date, o.window, o.status, o.notes ?? null,
          o.packer !== undefined ? userIds[o.packer] : null,
          o.driver !== undefined ? userIds[o.driver] : null,
          o.vehicle !== undefined ? vehicleIds[o.vehicle] : null,
          o.trailer !== undefined ? trailerIds[o.trailer] : null,
          stamp, stamp,
          findOrCreateCustomer({ customer_name: o.customer, address: o.address, postal_code: o.plz, city: o.city, phone: o.phone }, 1),
        ).id;
        run('UPDATE orders SET number = ? WHERE id = ?', `A${new Date().getFullYear()}-${String(orderId).padStart(4, '0')}`, orderId);

        let pos = 0;
        for (const it of o.items) {
          const product = get<any>('SELECT * FROM products WHERE name = ?', it.name);
          const rule = product?.deposit_rule_id ? get<any>('SELECT * FROM deposit_rules WHERE id = ?', product.deposit_rule_id) : null;
          const packaging = it.pack ?? 'einzeln';
          const deposit = calcDepositCents(rule, packaging, it.qty);
          let packed = 0;
          if (['gepackt', 'unterwegs', 'geliefert'].includes(o.status)) packed = it.qty;
          else if (o.status === 'packen') packed = pos < 2 ? it.qty : pos === 2 ? Math.floor(it.qty / 2) : 0;
          run(
            `INSERT INTO order_items (order_id, product_id, name, quantity, unit, packaging, deposit_rule_id, deposit_cents, packed_qty, position)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            orderId, product?.id ?? null, it.name, it.qty, it.unit ?? product?.unit ?? 'Stk', packaging, rule?.id ?? null, deposit, packed, pos++,
          );
        }
        orderCount++;
      }
      return { orders: orderCount, vehicles: vehicleIds.length, trailers: trailerIds.length, users: userIds.length };
    });

    ctx.status = 201;
    return { ...counts, password, usernames: DEMO_USERS.map((u) => u.username) };
  });

  r.delete('/demo-data', admin, () => {
    return tx(() => {
      const orders = run('DELETE FROM orders WHERE demo = 1').changes;
      run("DELETE FROM fleet_logs WHERE demo = 1 OR (kind = 'vehicles' AND ref_id IN (SELECT id FROM vehicles WHERE demo = 1)) OR (kind = 'trailers' AND ref_id IN (SELECT id FROM trailers WHERE demo = 1))");
      const vehicles = run('DELETE FROM vehicles WHERE demo = 1').changes;
      const trailers = run('DELETE FROM trailers WHERE demo = 1').changes;
      const users = run('DELETE FROM users WHERE demo = 1').changes;
      const customers = run('DELETE FROM customers WHERE demo = 1 AND id NOT IN (SELECT customer_id FROM orders WHERE customer_id IS NOT NULL)').changes;
      return { orders, vehicles, trailers, users, customers };
    });
  });
}
