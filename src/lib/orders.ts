import { all, get, getSetting } from '../db.ts';
import type { SessionUser } from '../types.ts';

/** SQL: Position ist erledigt (gepackt, als nicht lieferbar markiert oder Ersatz gepackt). */
export function doneSql(a = 'i'): string {
  return `(${a}.item_status = 'nicht_lieferbar'
    OR (${a}.item_status = 'ersatz' AND ${a}.packed_qty >= COALESCE(${a}.repl_qty, ${a}.quantity))
    OR (${a}.item_status NOT IN ('nicht_lieferbar','ersatz') AND ${a}.packed_qty >= ${a}.quantity))`;
}

const ORDER_SELECT = `
SELECT o.*,
       p.name AS packer_name,
       d.name AS driver_name,
       v.plate AS vehicle_plate, v.name AS vehicle_name,
       t.plate AS trailer_plate, t.name AS trailer_name,
       (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count,
       (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND ${doneSql('i')}) AS packed_count,
       (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.item_status <> 'normal') AS issue_count,
       (SELECT COALESCE(SUM(i.deposit_cents), 0) FROM order_items i WHERE i.order_id = o.id) AS deposit_total_cents
  FROM orders o
  LEFT JOIN users p ON p.id = o.packer_id
  LEFT JOIN users d ON d.id = o.driver_id
  LEFT JOIN vehicles v ON v.id = o.vehicle_id
  LEFT JOIN trailers t ON t.id = o.trailer_id`;

const ORDER_BY = 'ORDER BY (o.delivery_date IS NULL), o.delivery_date, o.id';

/** Darf dieser Benutzer Pfandbetraege sehen? Packer nur, wenn der Admin es erlaubt hat. */
export function depositVisibleTo(user: SessionUser, packContext = false): boolean {
  if (user.roles.includes('admin')) return true;
  // Packer: Pfand nur, wenn erlaubt. Wer zusaetzlich Fahrer ist, sieht es in der Fahrer-Ansicht immer.
  if (user.roles.includes('packer') && (packContext || !user.roles.includes('driver'))) {
    return getSetting('packer_show_deposit', '1') === '1';
  }
  return true;
}

const ITEM_DEPOSIT_FIELDS = ['deposit_rule_id', 'deposit_rule_name', 'deposit_cents', 'deposit_override_cents', 'orig_deposit_cents'];

export function loadItems(orderId: number): any[] {
  return all(
    `SELECT i.*, r.name AS deposit_rule_name
       FROM order_items i LEFT JOIN deposit_rules r ON r.id = i.deposit_rule_id
      WHERE i.order_id = ? ORDER BY i.position, i.id`,
    orderId,
  );
}

/** Entfernt serverseitig alle Pfand-Felder, wenn der Betrachter sie nicht sehen darf. */
export function shapeOrder(order: any, items: any[] | undefined, showDeposit: boolean): any {
  const out: any = { ...order };
  if ('signature_strokes' in out) {
    out.has_signature = !!out.signed_at;
    delete out.signature_strokes;
  }
  if (items) {
    out.items = items.map((it) => {
      const copy: any = { ...it };
      copy.target_qty = it.item_status === 'ersatz' ? (it.repl_qty ?? it.quantity) : it.quantity;
      copy.done = it.item_status === 'nicht_lieferbar' || it.packed_qty >= copy.target_qty;
      if (!showDeposit) for (const f of ITEM_DEPOSIT_FIELDS) delete copy[f];
      return copy;
    });
  }
  if (!showDeposit) delete out.deposit_total_cents;
  return out;
}

export function queryOrders(
  user: SessionUser,
  where: string,
  params: (string | number | null)[],
  opts: { items?: boolean; newestFirst?: boolean; pack?: boolean } = {},
): any[] {
  const order = opts.newestFirst ? 'ORDER BY o.delivery_date DESC, o.id DESC' : ORDER_BY;
  const rows = all(`${ORDER_SELECT} ${where ? `WHERE ${where}` : ''} ${order}`, ...params);
  const show = depositVisibleTo(user, !!opts.pack);
  return rows.map((o) => shapeOrder(o, opts.items ? loadItems(o.id) : undefined, show));
}

export function getOrder(user: SessionUser, id: number, withItems = true, pack = false): any | null {
  const row = get(`${ORDER_SELECT} WHERE o.id = ?`, id);
  if (!row) return null;
  return shapeOrder(row, withItems ? loadItems(id) : undefined, depositVisibleTo(user, pack));
}
