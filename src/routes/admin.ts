import { all, get, getSetting, run, setSetting } from '../db.ts';
import { destroyUserSessions, hashPassword, requireRole } from '../auth.ts';
import {
  bad,
  bool,
  HttpError,
  oneOf,
  optId,
  optStr,
  reqId,
  reqInt,
  reqStr,
} from '../lib/validate.ts';
import { PACKAGINGS } from '../types.ts';
import type { Role } from '../types.ts';
import { parseRoles, primaryRole, rolesToCsv, ROLES } from '../lib/roles.ts';
import type { Router } from '../lib/web.ts';

const admin = requireRole('admin');

const USER_COLS = 'id, username, name, role, roles, active, created_at';
function shapeUser(u: any): any {
  return { ...u, roles: parseRoles(u.roles, u.role) };
}
function readRoles(body: any): Role[] {
  const raw = Array.isArray(body.roles) ? body.roles : body.role !== undefined ? [body.role] : [];
  const roles = raw.map((r: unknown) => oneOf(r, ROLES, 'Rolle'));
  if (!roles.length) bad('Bitte mindestens eine Rolle auswählen');
  return parseRoles(roles.join(','));
}

function idOf(ctx: { params: Record<string, string> }): number {
  return reqId(ctx.params.id, 'ID');
}

function activeAdminsExcluding(userId: number): number {
  return all<{ n: number }>(
    "SELECT COUNT(*) AS n FROM users WHERE (',' || roles || ',') LIKE '%,admin,%' AND active = 1 AND id <> ?",
    userId,
  )[0].n;
}

export function register(r: Router): void {
  // ---------------- Benutzer ----------------
  r.get('/users', admin, () =>
    all<any>(`SELECT ${USER_COLS} FROM users ORDER BY active DESC, role, name`).map(shapeUser),
  );

  r.post('/users', admin, (ctx) => {
    const username = reqStr(ctx.body.username, 'Benutzername', 32);
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      bad('Benutzername: 3-32 Zeichen, nur Buchstaben, Zahlen, Punkt, Binde- und Unterstrich');
    }
    const name = reqStr(ctx.body.name, 'Name', 80);
    const roles = readRoles(ctx.body);
    const password = ctx.body.password;
    if (typeof password !== 'string' || password.length < 8) bad('Das Passwort muss mindestens 8 Zeichen lang sein');
    if (get('SELECT id FROM users WHERE username = ?', username)) throw new HttpError(409, 'Benutzername ist schon vergeben');
    const { id } = run(
      'INSERT INTO users (username, name, password_hash, role, roles) VALUES (?,?,?,?,?)',
      username,
      name,
      hashPassword(password),
      primaryRole(roles),
      rolesToCsv(roles),
    );
    ctx.status = 201;
    return shapeUser(get<any>(`SELECT ${USER_COLS} FROM users WHERE id = ?`, id));
  });

  r.put('/users/:id', admin, (ctx) => {
    const id = idOf(ctx);
    const existing = get<any>('SELECT * FROM users WHERE id = ?', id);
    if (!existing) throw new HttpError(404, 'Benutzer nicht gefunden');
    const name = reqStr(ctx.body.name, 'Name', 80);
    const roles = readRoles(ctx.body);
    const active = bool(ctx.body.active);

    const wasActiveAdmin = parseRoles(existing.roles, existing.role).includes('admin') && existing.active === 1;
    const staysActiveAdmin = roles.includes('admin') && active === 1;
    if (wasActiveAdmin && !staysActiveAdmin && activeAdminsExcluding(id) === 0) {
      bad('Es muss mindestens ein aktiver Administrator übrig bleiben');
    }
    if (id === ctx.user!.id && !staysActiveAdmin) bad('Du kannst dich nicht selbst sperren oder herabstufen');

    run('UPDATE users SET name = ?, role = ?, roles = ?, active = ? WHERE id = ?', name, primaryRole(roles), rolesToCsv(roles), active, id);
    const password = ctx.body.password;
    if (password !== undefined && password !== null && password !== '') {
      if (typeof password !== 'string' || password.length < 8) bad('Das Passwort muss mindestens 8 Zeichen lang sein');
      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), id);
      destroyUserSessions(id);
    }
    if (!active) destroyUserSessions(id);
    return shapeUser(get<any>(`SELECT ${USER_COLS} FROM users WHERE id = ?`, id));
  });

  // ---------------- Einstellungen ----------------
  r.get('/settings', admin, () => ({
    packer_show_deposit: getSetting('packer_show_deposit', '1') === '1',
  }));

  r.put('/settings', admin, (ctx) => {
    if (ctx.body.packer_show_deposit !== undefined) {
      setSetting('packer_show_deposit', bool(ctx.body.packer_show_deposit) ? '1' : '0');
    }
    return { packer_show_deposit: getSetting('packer_show_deposit', '1') === '1' };
  });

  // ---------------- Pfandregeln ----------------
  r.get('/deposit-rules', admin, () => all('SELECT * FROM deposit_rules ORDER BY name'));

  const parseRule = (body: any) => ({
    name: reqStr(body.name, 'Name', 120),
    bottle_cents: reqInt(body.bottle_cents, 'Pfand je Flasche', 0, 100_000),
    crate_cents: reqInt(body.crate_cents, 'Pfand je Kasten', 0, 100_000),
    bottles_per_crate: reqInt(body.bottles_per_crate, 'Flaschen pro Kasten', 1, 500),
    notes: optStr(body.notes, 'Notiz', 300),
  });

  r.post('/deposit-rules', admin, (ctx) => {
    const d = parseRule(ctx.body);
    const { id } = run(
      'INSERT INTO deposit_rules (name, bottle_cents, crate_cents, bottles_per_crate, notes) VALUES (?,?,?,?,?)',
      d.name,
      d.bottle_cents,
      d.crate_cents,
      d.bottles_per_crate,
      d.notes,
    );
    ctx.status = 201;
    return get('SELECT * FROM deposit_rules WHERE id = ?', id);
  });

  r.put('/deposit-rules/:id', admin, (ctx) => {
    const id = idOf(ctx);
    if (!get('SELECT id FROM deposit_rules WHERE id = ?', id)) throw new HttpError(404, 'Pfandregel nicht gefunden');
    const d = parseRule(ctx.body);
    run(
      'UPDATE deposit_rules SET name = ?, bottle_cents = ?, crate_cents = ?, bottles_per_crate = ?, notes = ? WHERE id = ?',
      d.name,
      d.bottle_cents,
      d.crate_cents,
      d.bottles_per_crate,
      d.notes,
      id,
    );
    return get('SELECT * FROM deposit_rules WHERE id = ?', id);
  });

  r.delete('/deposit-rules/:id', admin, (ctx) => {
    const id = idOf(ctx);
    run('DELETE FROM deposit_rules WHERE id = ?', id);
  });

  // ---------------- Produkte ----------------
  r.get('/products', admin, (ctx) => {
    const q = (ctx.query.get('q') ?? '').trim();
    const where = q ? 'WHERE p.name LIKE ? OR p.sku LIKE ? OR p.category LIKE ?' : '';
    const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
    return all(
      `SELECT p.*, r.name AS deposit_rule_name
         FROM products p LEFT JOIN deposit_rules r ON r.id = p.deposit_rule_id
         ${where} ORDER BY p.category, p.name`,
      ...params,
    );
  });

  const parseProduct = (body: any) => {
    const ruleId = optId(body.deposit_rule_id, 'Pfandregel');
    if (ruleId !== null && !get('SELECT id FROM deposit_rules WHERE id = ?', ruleId)) bad('Pfandregel nicht gefunden');
    return {
      name: reqStr(body.name, 'Produktname', 200),
      sku: optStr(body.sku, 'Artikelnummer', 50),
      category: optStr(body.category, 'Kategorie', 80),
      unit: optStr(body.unit, 'Einheit', 20) ?? 'Stk',
      is_beverage: bool(body.is_beverage),
      default_packaging: oneOf(body.default_packaging ?? 'einzeln', PACKAGINGS, 'Verpackung'),
      deposit_rule_id: ruleId,
    };
  };

  r.post('/products', admin, (ctx) => {
    const d = parseProduct(ctx.body);
    const { id } = run(
      'INSERT INTO products (name, sku, category, unit, is_beverage, default_packaging, deposit_rule_id) VALUES (?,?,?,?,?,?,?)',
      d.name,
      d.sku,
      d.category,
      d.unit,
      d.is_beverage,
      d.default_packaging,
      d.deposit_rule_id,
    );
    ctx.status = 201;
    return get('SELECT * FROM products WHERE id = ?', id);
  });

  r.put('/products/:id', admin, (ctx) => {
    const id = idOf(ctx);
    if (!get('SELECT id FROM products WHERE id = ?', id)) throw new HttpError(404, 'Produkt nicht gefunden');
    const d = parseProduct(ctx.body);
    run(
      'UPDATE products SET name = ?, sku = ?, category = ?, unit = ?, is_beverage = ?, default_packaging = ?, deposit_rule_id = ? WHERE id = ?',
      d.name,
      d.sku,
      d.category,
      d.unit,
      d.is_beverage,
      d.default_packaging,
      d.deposit_rule_id,
      id,
    );
    return get('SELECT * FROM products WHERE id = ?', id);
  });

  r.delete('/products/:id', admin, (ctx) => {
    run('DELETE FROM products WHERE id = ?', idOf(ctx));
  });
}
