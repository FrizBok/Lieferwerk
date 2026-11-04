import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, db, getSetting, setSetting } from '../db.ts';

export const BACKUP_DIR = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(DATA_DIR, 'backups');
export const BACKUP_NAME = /^lieferwerk-\d{8}-\d{6}-(auto|manuell)\.db$/;
const MANUAL_KEEP = 20;

export interface BackupInfo { name: string; kind: 'auto' | 'manuell'; size: number; created: string }

export function backupSettings(): { enabled: boolean; hour: number; keep: number } {
  return {
    enabled: getSetting('backup_enabled', '1') === '1',
    hour: Math.min(23, Math.max(0, Number(getSetting('backup_hour', '2')) || 0)),
    keep: Math.min(365, Math.max(1, Number(getSetting('backup_keep', '14')) || 14)),
  };
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((n) => BACKUP_NAME.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, kind: (name.endsWith('-auto.db') ? 'auto' : 'manuell') as BackupInfo['kind'], size: st.size, created: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Konsistente Kopie der laufenden Datenbank (auch waehrend Schreibzugriffen). */
export function createBackup(kind: 'auto' | 'manuell'): BackupInfo {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  let name = `lieferwerk-${stamp()}-${kind}.db`;
  for (let i = 1; fs.existsSync(path.join(BACKUP_DIR, name)); i++) name = `lieferwerk-${stamp(new Date(Date.now() + i * 1000))}-${kind}.db`;
  const target = path.join(BACKUP_DIR, name);
  const tmp = `${target}.tmp`;
  try {
    db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  prune();
  const st = fs.statSync(target);
  return { name, kind, size: st.size, created: st.mtime.toISOString() };
}

/** Aeltere Sicherungen loeschen: automatische nach Einstellung, manuelle max. 20. */
export function prune(): number {
  const { keep } = backupSettings();
  const all = listBackups();
  let removed = 0;
  for (const [kind, limit] of [['auto', keep], ['manuell', MANUAL_KEEP]] as const) {
    for (const b of all.filter((x) => x.kind === kind).slice(limit)) {
      fs.rmSync(path.join(BACKUP_DIR, b.name), { force: true });
      removed++;
    }
  }
  return removed;
}

export function deleteBackup(name: string): boolean {
  if (!BACKUP_NAME.test(name)) return false;
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

/** Pruefen, ob eine Sicherungsdatei eine brauchbare Lieferwerk-Datenbank ist. */
export function verifyBackupFile(file: string): void {
  const test = new DatabaseSync(file, { readOnly: true });
  try {
    const ok = test.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (ok.integrity_check !== 'ok') throw new Error('Die Datei ist beschädigt (Integritätsprüfung fehlgeschlagen).');
    const t = test.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users','orders')").all();
    if (t.length < 2) throw new Error('Das ist keine Lieferwerk-Datenbank.');
  } finally {
    test.close();
  }
}

/** Zeitpunkt der letzten geplanten Sicherung (heute oder gestern zur eingestellten Stunde). */
export function lastScheduledTime(now = new Date(), hour = backupSettings().hour): Date {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0);
  if (t.getTime() > now.getTime()) t.setDate(t.getDate() - 1);
  return t;
}

export function backupDue(now = new Date()): boolean {
  const s = backupSettings();
  if (!s.enabled) return false;
  const lastAuto = listBackups().find((b) => b.kind === 'auto');
  return !lastAuto || new Date(lastAuto.created).getTime() < lastScheduledTime(now, s.hour).getTime();
}

export function runScheduledBackup(): BackupInfo | null {
  if (!backupDue()) return null;
  try {
    const info = createBackup('auto');
    setSetting('backup_last_error', '');
    return info;
  } catch (e) {
    setSetting('backup_last_error', `${new Date().toISOString()} ${(e as Error).message}`);
    console.error('Automatische Sicherung fehlgeschlagen:', e);
    return null;
  }
}

/** Prueft alle 5 Minuten, ob eine Sicherung faellig ist (auch Nachholen nach Serverstillstand). */
export function startBackupScheduler(): void {
  setTimeout(() => runScheduledBackup(), 15_000).unref();
  setInterval(() => runScheduledBackup(), 5 * 60_000).unref();
}
