import { parseRoles, primaryRole, rolesToCsv } from './lib/roles.ts';
import { get, run } from './db.ts';
import { initDb } from './db.ts';
import { destroyUserSessions, hashPassword } from './auth.ts';

// Verwaltung per Kommandozeile, z. B. wenn das Admin-Passwort vergessen wurde:
//   npm run cli -- reset-password admin NeuesPasswort123
//   npm run cli -- create-user max "Max Mustermann" packer Passwort1234
//   docker compose exec lieferwerk node --disable-warning=ExperimentalWarning src/cli.ts reset-password admin NeuesPasswort123

initDb();
const [cmd, ...args] = process.argv.slice(2);

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (cmd === 'reset-password') {
  const [username, password] = args;
  if (!username || !password) fail('Aufruf: reset-password <benutzername> <neues-passwort>');
  if (password.length < 8) fail('Das Passwort muss mindestens 8 Zeichen lang sein.');
  const user = get<{ id: number }>('SELECT id FROM users WHERE username = ?', username);
  if (!user) fail(`Benutzer "${username}" nicht gefunden.`);
  run('UPDATE users SET password_hash = ?, active = 1 WHERE id = ?', hashPassword(password), user.id);
  destroyUserSessions(user.id);
  console.log(`Passwort für "${username}" wurde gesetzt.`);
} else if (cmd === 'create-user') {
  const [username, name, role, password] = args;
  if (!username || !name || !role || !password) fail('Aufruf: create-user <benutzername> "<name>" <rollen> <passwort>   (Rollen z. B. packer oder packer,driver)');
  const list = role.split(',').map((x) => x.trim());
  if (!list.length || list.some((x) => !['admin', 'packer', 'driver'].includes(x))) fail('Rollen: admin, packer, driver (mehrere mit Komma).');
  const roles = parseRoles(list.join(','));
  if (password.length < 8) fail('Das Passwort muss mindestens 8 Zeichen lang sein.');
  run('INSERT INTO users (username, name, password_hash, role, roles) VALUES (?,?,?,?,?)', username, name, hashPassword(password), primaryRole(roles), rolesToCsv(roles));
  console.log(`Benutzer "${username}" (${role}) wurde angelegt.`);
} else {
  fail('Befehle: reset-password, create-user');
}
