import { get, run } from '../db.ts';

export interface CustomerData {
  customer_name: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  phone: string | null;
}

/** Sucht einen Kunden mit gleichem Namen + Adresse + PLZ oder legt ihn neu an. */
export function findOrCreateCustomer(d: CustomerData, demo = 0): number {
  const found = get<any>(
    `SELECT id FROM customers WHERE lower(trim(name)) = lower(trim(?)) AND lower(trim(coalesce(address,''))) = lower(trim(?))
        AND lower(trim(coalesce(postal_code,''))) = lower(trim(?))`,
    d.customer_name,
    d.address ?? '',
    d.postal_code ?? '',
  );
  if (found) return found.id;
  return run(
    'INSERT INTO customers (name, address, postal_code, city, phone, demo) VALUES (?,?,?,?,?,?)',
    d.customer_name.trim(),
    d.address,
    d.postal_code,
    d.city,
    d.phone,
    demo,
  ).id;
}
