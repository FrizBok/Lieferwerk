import { all, get, run } from '../db.ts';
import { requireRole } from '../auth.ts';
import { getOrder, queryOrders } from '../lib/orders.ts';
import { stopSort } from './plan.ts';
import { HttpError, oneOf, reqId, reqNum } from '../lib/validate.ts';
import type { Router } from '../lib/web.ts';
import type { SessionUser } from '../types.ts';

const packerOrAdmin = requireRole('packer', 'admin');
const driverOrAdmin = requireRole('driver', 'admin');

/** Packer duerfen nur eigene oder noch nicht zugewiesene Auftraege bearbeiten. */
function loadPackableOrder(user: SessionUser, id: number): any {
  const order = get<any>('SELECT * FROM orders WHERE id = ?', id);
  if (!order) throw new HttpError(404, 'Auftrag nicht gefunden');
  if (!user.roles.includes('admin') && order.packer_id !== null && order.packer_id !== user.id) {
    throw new HttpError(403, 'Dieser Auftrag ist einem anderen Packer zugewiesen');
  }
  return order;
}

export function register(r: Router): void {
  // ---------------- Packen ----------------
  r.get('/pack/orders', packerOrAdmin, (ctx) => {
    const user = ctx.user!;
    const isAdmin = user.roles.includes('admin');
    const where =
      "o.status IN ('neu','packen','gepackt') AND (o.delivery_date IS NULL OR o.delivery_date >= date('now','localtime','-2 day'))" +
      (!isAdmin ? ' AND (o.packer_id = ? OR o.packer_id IS NULL)' : '');
    return queryOrders(user, where, !isAdmin ? [user.id] : [], { items: true, pack: true });
  });

  r.get('/pack/orders/:id', packerOrAdmin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    loadPackableOrder(ctx.user!, id);
    return getOrder(ctx.user!, id, true, true);
  });

  r.post('/pack/orders/:id/take', packerOrAdmin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const order = loadPackableOrder(ctx.user!, id);
    if (order.packer_id === null && ctx.user!.roles.includes('packer')) {
      run("UPDATE orders SET packer_id = ?, updated_at = datetime('now') WHERE id = ?", ctx.user!.id, id);
    }
    return getOrder(ctx.user!, id, true, true);
  });

  r.post('/pack/items/:id', packerOrAdmin, (ctx) => {
    const itemId = reqId(ctx.params.id, 'ID');
    const item = get<any>('SELECT * FROM order_items WHERE id = ?', itemId);
    if (!item) throw new HttpError(404, 'Position nicht gefunden');
    const order = loadPackableOrder(ctx.user!, item.order_id);
    if (order.status === 'gepackt') throw new HttpError(409, 'Die Packliste ist schon abgeschlossen. Bitte zuerst wieder öffnen.');
    if (!['neu', 'packen'].includes(order.status)) throw new HttpError(409, 'Dieser Auftrag kann nicht mehr gepackt werden');

    const qty = Math.min(Math.max(reqNum(ctx.body.packed_qty, 'Gepackte Menge', 0, 100_000), 0), item.quantity);
    run('UPDATE order_items SET packed_qty = ? WHERE id = ?', qty, itemId);
    // Erste Aktion: Packer uebernimmt den Auftrag, Status wechselt auf "packen"
    if (order.status === 'neu' || order.packer_id === null) {
      run(
        `UPDATE orders SET status = 'packen', packer_id = COALESCE(packer_id, ?), updated_at = datetime('now') WHERE id = ?`,
        ctx.user!.roles.includes('packer') ? ctx.user!.id : null,
        order.id,
      );
    }
    return getOrder(ctx.user!, order.id, true, true);
  });

  r.post('/pack/orders/:id/complete', packerOrAdmin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const order = loadPackableOrder(ctx.user!, id);
    if (!['neu', 'packen'].includes(order.status)) throw new HttpError(409, 'Die Packliste ist schon abgeschlossen');
    const open = all<{ n: number }>(
      'SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND packed_qty < quantity',
      id,
    )[0].n;
    if (open > 0 && ctx.body.force !== true) {
      throw new HttpError(409, `Noch ${open} Position(en) nicht vollständig gepackt`);
    }
    run(
      `UPDATE orders SET status = 'gepackt', packer_id = COALESCE(packer_id, ?), updated_at = datetime('now') WHERE id = ?`,
      ctx.user!.roles.includes('packer') ? ctx.user!.id : null,
      id,
    );
    return getOrder(ctx.user!, id, true, true);
  });

  r.post('/pack/orders/:id/reopen', packerOrAdmin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const order = loadPackableOrder(ctx.user!, id);
    if (order.status !== 'gepackt') throw new HttpError(409, 'Nur abgeschlossene Packlisten können wieder geöffnet werden');
    run("UPDATE orders SET status = 'packen', updated_at = datetime('now') WHERE id = ?", id);
    return getOrder(ctx.user!, id, true, true);
  });

  // ---------------- Fahrer ----------------
  r.get('/driver/orders', driverOrAdmin, (ctx) => {
    const user = ctx.user!;
    const isAdmin = user.roles.includes('admin');
    const where =
      "(o.status IN ('gepackt','unterwegs') OR (o.status = 'geliefert' AND o.delivery_date = date('now','localtime')))" +
      (!isAdmin ? ' AND o.driver_id = ?' : '');
    return queryOrders(user, where, !isAdmin ? [user.id] : [], { items: true }).sort(
      (a, b) => String(a.delivery_date ?? '').localeCompare(String(b.delivery_date ?? '')) || stopSort(a, b),
    );
  });

  r.post('/driver/orders/:id/status', driverOrAdmin, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const status = oneOf(ctx.body.status, ['gepackt', 'unterwegs', 'geliefert'] as const, 'Status');
    const order = get<any>('SELECT * FROM orders WHERE id = ?', id);
    if (!order) throw new HttpError(404, 'Auftrag nicht gefunden');
    if (!ctx.user!.roles.includes('admin') && order.driver_id !== ctx.user!.id) {
      throw new HttpError(403, 'Dieser Auftrag ist einem anderen Fahrer zugewiesen');
    }
    const allowed: Record<string, string[]> = {
      gepackt: ['unterwegs'],
      unterwegs: ['geliefert', 'gepackt'],
      geliefert: ['unterwegs'],
    };
    if (!(allowed[order.status] ?? []).includes(status)) {
      throw new HttpError(409, `Wechsel von "${order.status}" zu "${status}" ist nicht möglich`);
    }
    run("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?", status, id);
    return getOrder(ctx.user!, id);
  });
}
