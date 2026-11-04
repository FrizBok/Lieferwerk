import fs from 'node:fs';
import path from 'node:path';
import { getSetting, setSetting } from '../db.ts';
import { requireRole } from '../auth.ts';
import { BACKUP_DIR, BACKUP_NAME, backupSettings, createBackup, deleteBackup, listBackups } from '../lib/backup.ts';
import { bool, HttpError, reqInt } from '../lib/validate.ts';
import { Raw } from '../lib/web.ts';
import type { Router } from '../lib/web.ts';

const admin = requireRole('admin');

function overview(): any {
  const s = backupSettings();
  const items = listBackups();
  return {
    settings: s,
    items,
    dir: BACKUP_DIR,
    last_auto: items.find((b) => b.kind === 'auto')?.created ?? null,
    last_error: getSetting('backup_last_error', '') || null,
  };
}

export function register(r: Router): void {
  r.get('/backups', admin, () => overview());

  r.put('/backups/settings', admin, (ctx) => {
    const cur = backupSettings();
    const enabled = ctx.body.enabled === undefined ? cur.enabled : !!bool(ctx.body.enabled);
    const hour = ctx.body.hour === undefined ? cur.hour : reqInt(ctx.body.hour, 'Uhrzeit', 0, 23);
    const keep = ctx.body.keep === undefined ? cur.keep : reqInt(ctx.body.keep, 'Aufbewahren', 1, 365);
    setSetting('backup_enabled', enabled ? '1' : '0');
    setSetting('backup_hour', String(hour));
    setSetting('backup_keep', String(keep));
    return overview();
  });

  r.post('/backups', admin, (ctx) => {
    try {
      createBackup('manuell');
    } catch (e) {
      throw new HttpError(500, `Sicherung fehlgeschlagen: ${(e as Error).message}`);
    }
    ctx.status = 201;
    return overview();
  });

  r.get('/backups/:name', admin, (ctx) => {
    const name = ctx.params.name;
    if (!BACKUP_NAME.test(name)) throw new HttpError(400, 'Ungültiger Dateiname');
    const file = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Sicherung nicht gefunden');
    return new Raw(fs.readFileSync(file), 'application/vnd.sqlite3', name, true);
  });

  r.delete('/backups/:name', admin, (ctx) => {
    if (!BACKUP_NAME.test(ctx.params.name)) throw new HttpError(400, 'Ungültiger Dateiname');
    if (!deleteBackup(ctx.params.name)) throw new HttpError(404, 'Sicherung nicht gefunden');
    return overview();
  });
}
