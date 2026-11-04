import type { Role } from '../types.ts';

export const ROLES = ['admin', 'packer', 'driver'] as const;

/** Liest die kommagetrennte Rollenliste aus der DB (Reihenfolge: admin, packer, driver). */
export function parseRoles(csv: unknown, fallback?: unknown): Role[] {
  const raw = [String(csv ?? ''), String(fallback ?? '')].find((s) => s.trim() !== '') ?? '';
  const set = new Set(raw.split(',').map((s) => s.trim()));
  return ROLES.filter((r) => set.has(r));
}

export function rolesToCsv(roles: readonly Role[]): string {
  return ROLES.filter((r) => roles.includes(r)).join(',');
}

/** Hauptrolle (fuer die Spalte "role"): admin vor packer vor driver. */
export function primaryRole(roles: readonly Role[]): Role {
  return ROLES.find((r) => roles.includes(r)) ?? 'packer';
}

/** SQL-Bedingung: Benutzer besitzt die Rolle (Spalte roles, ggf. mit Tabellenalias). */
export function hasRoleSql(role: Role, alias = ''): string {
  const col = alias ? `${alias}.roles` : 'roles';
  return `(',' || ${col} || ',') LIKE '%,${role},%'`;
}
