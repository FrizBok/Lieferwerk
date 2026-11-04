import { parseRoles, primaryRole } from '../lib/roles.ts';
import { get, run, tx } from '../db.ts';
import {
  clearCookie,
  COOKIE_NAME,
  createSession,
  destroySession,
  destroyUserSessions,
  hashPassword,
  readCookie,
  requireAuth,
  sessionCookie,
  userCount,
  verifyPassword,
} from '../auth.ts';
import { depositVisibleTo } from '../lib/orders.ts';
import { HttpError, reqStr } from '../lib/validate.ts';
import type { Router } from '../lib/web.ts';

const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 8;
const BLOCK_MS = 15 * 60 * 1000;
// Wird fuer unbekannte Benutzer geprueft, damit die Antwortzeit nichts verraet.
const DUMMY_HASH = hashPassword('dummy-password');

export function register(r: Router): void {
  r.get('/health', () => ({ ok: true }));

  r.get('/setup-status', () => ({ needs_setup: userCount() === 0 }));

  // Ersteinrichtung: legt den ersten Administrator an (nur solange es noch keinen Benutzer gibt).
  r.post('/setup', (ctx) => {
    const name = reqStr(ctx.body.name, 'Name', 80);
    const username = reqStr(ctx.body.username, 'Benutzername', 32);
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      throw new HttpError(400, 'Benutzername: 3-32 Zeichen, nur Buchstaben, Zahlen, Punkt, Binde- und Unterstrich');
    }
    const password = ctx.body.password;
    if (typeof password !== 'string' || password.length < 8) {
      throw new HttpError(400, 'Das Passwort muss mindestens 8 Zeichen lang sein');
    }
    const hash = hashPassword(password);
    const id = tx(() => {
      if (userCount() > 0) throw new HttpError(409, 'Die Einrichtung wurde bereits abgeschlossen');
      return run('INSERT INTO users (username, name, password_hash, role, roles) VALUES (?,?,?,?,?)', username, name, hash, 'admin', 'admin').id;
    });
    ctx.headers['Set-Cookie'] = sessionCookie(createSession(id));
    ctx.status = 201;
    return { user: { id, username, name, role: 'admin', roles: ['admin'] } };
  });

  r.post('/login', (ctx) => {
    const username = reqStr(ctx.body.username, 'Benutzername', 60);
    const password = ctx.body.password;
    if (typeof password !== 'string' || !password) throw new HttpError(400, 'Passwort fehlt');

    const key = `${ctx.ip}|${username.toLowerCase()}`;
    const entry = attempts.get(key);
    if (entry && entry.until > Date.now()) {
      throw new HttpError(429, 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
    }

    const user = get<any>('SELECT * FROM users WHERE username = ? AND active = 1', username);
    const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH) && !!user;
    if (!ok) {
      const count = (entry && entry.until <= Date.now() ? 0 : (entry?.count ?? 0)) + 1;
      attempts.set(key, { count, until: count >= MAX_ATTEMPTS ? Date.now() + BLOCK_MS : 0 });
      throw new HttpError(401, 'Benutzername oder Passwort ist falsch');
    }
    attempts.delete(key);

    const token = createSession(user.id);
    ctx.headers['Set-Cookie'] = sessionCookie(token);
    const roles = parseRoles(user.roles, user.role);
    return { user: { id: user.id, username: user.username, name: user.name, role: primaryRole(roles), roles } };
  });

  r.post('/logout', (ctx) => {
    const token = readCookie(ctx.req, COOKIE_NAME);
    if (token) destroySession(token);
    ctx.headers['Set-Cookie'] = clearCookie();
  });

  r.get('/me', requireAuth, (ctx) => ({
    user: ctx.user,
    can_see_deposit: depositVisibleTo(ctx.user!),
  }));

  r.post('/me/password', requireAuth, (ctx) => {
    const current = ctx.body.current_password;
    const next = ctx.body.new_password;
    if (typeof current !== 'string' || typeof next !== 'string') throw new HttpError(400, 'Passwörter fehlen');
    if (next.length < 8) throw new HttpError(400, 'Das neue Passwort muss mindestens 8 Zeichen lang sein');
    const row = get<any>('SELECT password_hash FROM users WHERE id = ?', ctx.user!.id);
    if (!row || !verifyPassword(current, row.password_hash)) {
      throw new HttpError(400, 'Das aktuelle Passwort ist falsch');
    }
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), ctx.user!.id);
    // alle anderen Sitzungen beenden, aktuelle neu anlegen
    destroyUserSessions(ctx.user!.id);
    ctx.headers['Set-Cookie'] = sessionCookie(createSession(ctx.user!.id));
  });
}
