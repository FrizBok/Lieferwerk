export interface DepositRule {
  id: number;
  name: string;
  /** Pfand je Flasche/Dose in Cent */
  bottle_cents: number;
  /** Pfand je Kasten (leer, ohne Flaschen) in Cent */
  crate_cents: number;
  /** Anzahl Flaschen pro Kasten */
  bottles_per_crate: number;
}

/**
 * Pfand einer Position in Cent.
 *  - einzeln: Menge x Flaschenpfand
 *  - kasten:  Menge x (Kastenpfand + Flaschen pro Kasten x Flaschenpfand)
 */
export function calcDepositCents(
  rule: DepositRule | null | undefined,
  packaging: string,
  quantity: number,
): number {
  if (!rule) return 0;
  const perUnit =
    packaging === 'kasten'
      ? rule.crate_cents + rule.bottles_per_crate * rule.bottle_cents
      : rule.bottle_cents;
  return Math.round(quantity * perUnit);
}
