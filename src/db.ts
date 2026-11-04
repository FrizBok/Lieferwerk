import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'lieferwerk.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

type Param = string | number | bigint | null | Uint8Array | undefined;

function clean(p: Param[]): Exclude<Param, undefined>[] {
  return p.map((x) => (x === undefined ? null : x));
}

export function all<T = any>(sql: string, ...params: Param[]): T[] {
  const rows = db.prepare(sql).all(...clean(params)) as unknown as T[];
  return rows.map((r) => ({ ...(r as object) }) as T);
}

export function get<T = any>(sql: string, ...params: Param[]): T | undefined {
  const row = db.prepare(sql).get(...clean(params)) as unknown as T | undefined;
  return row ? ({ ...(row as object) } as T) : undefined;
}

export function run(sql: string, ...params: Param[]): { changes: number; id: number } {
  const r = db.prepare(sql).run(...clean(params));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting(key: string, fallback: string): string {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}

export function setSetting(key: string, value: string): void {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','packer','driver')),
  roles TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deposit_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bottle_cents INTEGER NOT NULL DEFAULT 0,
  crate_cents INTEGER NOT NULL DEFAULT 0,
  bottles_per_crate INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'Stk',
  is_beverage INTEGER NOT NULL DEFAULT 0,
  default_packaging TEXT NOT NULL DEFAULT 'einzeln' CHECK (default_packaging IN ('einzeln','kasten')),
  deposit_rule_id INTEGER REFERENCES deposit_rules(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  postal_code TEXT,
  city TEXT,
  phone TEXT,
  notes TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate TEXT NOT NULL,
  name TEXT,
  type TEXT NOT NULL DEFAULT 'transporter',
  status TEXT NOT NULL DEFAULT 'verfuegbar' CHECK (status IN ('verfuegbar','werkstatt')),
  capacity TEXT,
  inspection_date TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS trailers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate TEXT NOT NULL,
  name TEXT,
  type TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'verfuegbar' CHECK (status IN ('verfuegbar','werkstatt')),
  capacity TEXT,
  inspection_date TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  customer_name TEXT NOT NULL,
  address TEXT,
  postal_code TEXT,
  city TEXT,
  phone TEXT,
  delivery_date TEXT,
  time_window TEXT,
  status TEXT NOT NULL DEFAULT 'neu' CHECK (status IN ('neu','packen','gepackt','unterwegs','geliefert','storniert')),
  notes TEXT,
  packer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  driver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  trailer_id INTEGER REFERENCES trailers(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'Stk',
  packaging TEXT NOT NULL DEFAULT 'einzeln' CHECK (packaging IN ('einzeln','kasten')),
  deposit_rule_id INTEGER REFERENCES deposit_rules(id) ON DELETE SET NULL,
  deposit_override_cents INTEGER,
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  packed_qty REAL NOT NULL DEFAULT 0,
  note TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(delivery_date);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
`;

export function initDb(): void {
  db.exec(SCHEMA);
  // Migration: aeltere Datenbanken ohne Spalte "roles"
  const cols = all<{ name: string }>('PRAGMA table_info(users)').map((c) => c.name);
  if (!cols.includes('roles')) db.exec("ALTER TABLE users ADD COLUMN roles TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE users SET roles = role WHERE roles = ''");
  // Markierung fuer Testdaten (damit sie sich per Knopfdruck wieder entfernen lassen)
  for (const table of ['users', 'vehicles', 'trailers', 'orders']) {
    const have = all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);
    if (!have.includes('demo')) db.exec(`ALTER TABLE ${table} ADD COLUMN demo INTEGER NOT NULL DEFAULT 0`);
  }
  // Kunden: Spalte customer_id an Auftraegen + Uebernahme bisheriger Kunden aus den Auftraegen
  const orderCols = all<{ name: string }>('PRAGMA table_info(orders)').map((c) => c.name);
  if (!orderCols.includes('customer_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)');
  backfillCustomers();
  seedExamples();
}

/** Ordnet Auftraegen ohne Kunden einen Kunden zu (gleicher Name + Adresse + PLZ = ein Kunde). */
function backfillCustomers(): void {
  const rows = all<any>(
    `SELECT id, customer_name, address, postal_code, city, phone FROM orders WHERE customer_id IS NULL ORDER BY id`,
  );
  if (!rows.length) return;
  tx(() => {
    const seen = new Map<string, number>();
    for (const o of rows) {
      const key = [o.customer_name, o.address ?? '', o.postal_code ?? ''].map((s: string) => String(s).trim().toLowerCase()).join('|');
      let cid = seen.get(key);
      if (cid === undefined) {
        const found = get<any>(
          `SELECT id FROM customers WHERE lower(trim(name)) = lower(trim(?)) AND lower(trim(coalesce(address,''))) = lower(trim(?))
              AND lower(trim(coalesce(postal_code,''))) = lower(trim(?))`,
          o.customer_name, o.address ?? '', o.postal_code ?? '',
        );
        cid = found
          ? found.id
          : run('INSERT INTO customers (name, address, postal_code, city, phone) VALUES (?,?,?,?,?)', o.customer_name, o.address, o.postal_code, o.city, o.phone).id;
        seen.set(key, cid!);
      }
      run('UPDATE orders SET customer_id = ? WHERE id = ?', cid!, o.id);
    }
  });
}

/** Beispiel-Pfandregeln und -Produkte beim allerersten Start (Betraege bitte pruefen/anpassen). */
function seedExamples(): void {
  if (getSetting('seeded', '0') === '1') return;
  tx(() => {
    const rules: [string, number, number, number][] = [
      ['Einweg (0,25 € je Flasche/Dose)', 25, 0, 6],
      ['Mehrweg Glas (0,08 € + Kasten 1,50 €, 12 Fl.)', 8, 150, 12],
      ['Mehrweg Bier (0,08 € + Kasten 3,10 €, 20 Fl.)', 8, 310, 20],
      ['Mehrweg PET (0,15 € + Kasten 1,50 €, 12 Fl.)', 15, 150, 12],
    ];
    const ids: number[] = [];
    for (const [name, bottle, crate, per] of rules) {
      ids.push(
        run(
          'INSERT INTO deposit_rules (name, bottle_cents, crate_cents, bottles_per_crate) VALUES (?,?,?,?)',
          name,
          bottle,
          crate,
          per,
        ).id,
      );
    }
    const [einweg, glas, bier, pet] = ids;
    const products: [string, string, string, string, number, string, number | null][] = [
      ['Mineralwasser still 0,75 l', 'Getränke', 'Kasten', 'Stk', 1, 'kasten', glas],
      ['Cola 1,0 l', 'Getränke', 'Kasten', 'Stk', 1, 'kasten', pet],
      ['Pils 0,5 l', 'Getränke', 'Kasten', 'Stk', 1, 'kasten', bier],
      ['Energy Drink Dose 0,25 l', 'Getränke', 'Stk', 'Stk', 1, 'einzeln', einweg],
      ['Milch 1 l', 'Molkerei', 'Stk', 'Stk', 0, 'einzeln', null],
      ['Brot', 'Backwaren', 'Stk', 'Stk', 0, 'einzeln', null],
      ['Äpfel', 'Obst & Gemüse', 'kg', 'kg', 0, 'einzeln', null],
      ['Nudeln 500 g', 'Trockenwaren', 'Stk', 'Stk', 0, 'einzeln', null],
    ];
    for (const [name, category, , unit, bev, pack, rule] of products) {
      run(
        'INSERT INTO products (name, category, unit, is_beverage, default_packaging, deposit_rule_id) VALUES (?,?,?,?,?,?)',
        name,
        category,
        unit === 'Kasten' ? 'Stk' : unit,
        bev,
        pack,
        rule,
      );
    }
    setSetting('seeded', '1');
    setSetting('packer_show_deposit', '1');
  });
}
