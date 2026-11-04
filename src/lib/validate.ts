export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function bad(message: string): never {
  throw new HttpError(400, message);
}

export function reqStr(v: unknown, field: string, max = 200): string {
  if (typeof v !== 'string' || !v.trim()) bad(`${field} fehlt`);
  const s = (v as string).trim();
  if (s.length > max) bad(`${field} ist zu lang (max. ${max} Zeichen)`);
  return s;
}

export function optStr(v: unknown, field: string, max = 500): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') bad(`${field} ist ungültig`);
  const s = (v as string).trim();
  if (!s) return null;
  if (s.length > max) bad(`${field} ist zu lang (max. ${max} Zeichen)`);
  return s;
}

export function reqNum(v: unknown, field: string, min = 0, max = 1_000_000): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) bad(`${field} ist keine gültige Zahl`);
  const num = n as number;
  if (num < min || num > max) bad(`${field} muss zwischen ${min} und ${max} liegen`);
  return num;
}

export function reqInt(v: unknown, field: string, min = 0, max = 1_000_000): number {
  const n = reqNum(v, field, min, max);
  if (!Number.isInteger(n)) bad(`${field} muss eine ganze Zahl sein`);
  return n;
}

/** Ganze Zahl oder null (leer/nicht gesetzt). */
export function optInt(v: unknown, field: string, min = 0, max = 1_000_000_000): number | null {
  if (v === null || v === undefined || v === '') return null;
  return reqInt(v, field, min, max);
}

export function optId(v: unknown, field: string): number | null {
  return optInt(v, field, 1, Number.MAX_SAFE_INTEGER);
}

export function reqId(v: unknown, field: string): number {
  return reqInt(v, field, 1, Number.MAX_SAFE_INTEGER);
}

export function bool(v: unknown): 0 | 1 {
  return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    bad(`${field} ist ungültig`);
  }
  return v as T;
}

export function optDate(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad(`${field} ist kein gültiges Datum`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) bad(`${field} ist kein gültiges Datum`);
  return v as string;
}
