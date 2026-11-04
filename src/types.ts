export type Role = 'admin' | 'packer' | 'driver';

export interface SessionUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  roles: Role[];
}

export const ORDER_STATUSES = ['neu', 'packen', 'gepackt', 'unterwegs', 'geliefert', 'storniert'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PACKAGINGS = ['einzeln', 'kasten'] as const;
export type Packaging = (typeof PACKAGINGS)[number];
