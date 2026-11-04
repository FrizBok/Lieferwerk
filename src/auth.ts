import { parseRoles, primaryRole } from './lib/roles.ts';
import crypto from 'node:crypto';
import type http from 'node:http';
import { all, get, run } from './db.ts';
import { HttpError } from './lib/validate.ts';
import type { Handler } from './lib/web.ts';
import type { Role, SessionUser } from './types.ts';

export const COOKIE_NAME = 'lw_session';
export const SESSION_DAYS = 14;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(token), userId, expires);
  return token;
}

export function destroySession(token: string): void {
  run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function destroyUserSessions(userId: number): void {
  run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function readCookie(req: http.IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function userFromRequest(req: http.IncomingMessage): SessionUser | null {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  const row = get<any>(
    `SELECT u.id, u.username, u.name, u.role, u.roles
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    sha256(token),
    Date.now(),
  );
  if (!row) return null;
  const roles = parseRoles(row.roles, row.role);
  return { id: row.id, username: row.username, name: row.name, role: primaryRole(roles), roles };
}

export function sessionCookie(token: string): string {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 3600}${secure}`;
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export const requireAuth: Handler = (ctx) => {
  if (!ctx.user) throw new HttpError(401, 'Bitte anmelden');
};

export function requireRole(...roles: Role[]): Handler {
  return (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'Bitte anmelden');
    if (!ctx.user.roles.some((r) => roles.includes(r))) throw new HttpError(403, 'Dafür fehlt die Berechtigung');
  };
}

/** Anzahl vorhandener Benutzer (0 = Ersteinrichtung nötig). */
export function userCount(): number {
  return all<{ n: number }>('SELECT COUNT(*) AS n FROM users')[0].n;
}

/**
 * Optional: Wenn ADMIN_PASSWORD gesetzt ist (z. B. bei Docker), wird beim ersten Start
 * automatisch der Benutzer "admin" angelegt. Sonst erfolgt die Einrichtung im Browser.
 */
export function ensureAdmin(): void {
  if (userCount() > 0) return;
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv && fromEnv.length >= 8) {
    run(
      "INSERT INTO users (username, name, password_hash, role, roles) VALUES ('admin', 'Administrator', ?, 'admin', 'admin')",
      hashPassword(fromEnv),
    );
    console.log('Admin-Benutzer "admin" wurde mit dem Passwort aus ADMIN_PASSWORD angelegt.');
  } else {
    console.log('Noch kein Benutzer vorhanden: Bitte im Browser den ersten Benutzer einrichten.');
  }
}
