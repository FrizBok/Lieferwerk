import { get, getSetting, run } from '../db.ts';
import { requireAuth, requireRole } from '../auth.ts';
import { buildDeliveryNote } from '../lib/deliverynote.ts';
import { loadItems, getOrder } from '../lib/orders.ts';
import { bad, HttpError, reqId, reqStr } from '../lib/validate.ts';
import { Raw } from '../lib/web.ts';
import type { Router } from '../lib/web.ts';
import type { SessionUser } from '../types.ts';

const MAX_STROKES = 200;
const MAX_POINTS = 6000;

function loadFor(user: SessionUser, id: number): any {
  const o = get<any>('SELECT * FROM orders WHERE id = ?', id);
  if (!o) throw new HttpError(404, 'Auftrag nicht gefunden');
  const isAdmin = user.roles.includes('admin');
  if (!isAdmin && !(user.roles.includes('driver') && o.driver_id === user.id)) {
    throw new HttpError(403, 'Dieser Auftrag gehört nicht zu deinen Touren');
  }
  return o;
}

/** Striche als [[x,y],...] mit Werten 0..1 pruefen. */
function parseStrokes(v: unknown): [number, number][][] {
  if (!Array.isArray(v) || v.length === 0) bad('Bitte unterschreiben');
  if (v.length > MAX_STROKES) bad('Unterschrift ist zu komplex');
  let points = 0;
  return v.map((s: unknown) => {
    if (!Array.isArray(s) || s.length === 0) bad('Ungültige Unterschrift');
    return s.map((pt: unknown) => {
      if (!Array.isArray(pt) || pt.length !== 2) bad('Ungültige Unterschrift');
      const [x, y] = pt as number[];
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) bad('Ungültige Unterschrift');
      if (++points > MAX_POINTS) bad('Unterschrift ist zu komplex');
      return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as [number, number];
    });
  });
}

export function register(r: Router): void {
  r.get('/orders/:id/lieferschein.pdf', requireAuth, (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const user = ctx.user!;
    loadFor(user, id);
    const order = getOrder(user, id, false)!;
    const full = get<any>('SELECT signature_strokes FROM orders WHERE id = ?', id);
    const pdf = buildDeliveryNote({
      order,
      items: loadItems(id),
      company: { name: getSetting('company_name', ''), address: getSetting('company_address', ''), phone: getSetting('company_phone', '') },
      strokes: full?.signature_strokes ? JSON.parse(full.signature_strokes) : null,
      showDeposit: true,
    });
    return new Raw(pdf, 'application/pdf', `Lieferschein-${order.number}.pdf`);
  });

  r.post('/driver/orders/:id/signature', requireRole('driver', 'admin'), (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    const user = ctx.user!;
    const o = loadFor(user, id);
    if (!['gepackt', 'unterwegs', 'geliefert'].includes(o.status)) bad('Der Auftrag ist noch nicht gepackt');
    const name = reqStr(ctx.body.name, 'Name des Empfängers', 80);
    const strokes = parseStrokes(ctx.body.strokes);
    const deliver = ctx.body.mark_delivered === true && o.status !== 'geliefert';
    run(
      `UPDATE orders SET signature_strokes = ?, signed_name = ?, signed_at = datetime('now','localtime'),
              status = CASE WHEN ? = 1 THEN 'geliefert' ELSE status END, updated_at = datetime('now') WHERE id = ?`,
      JSON.stringify(strokes), name, deliver ? 1 : 0, id,
    );
    return getOrder(user, id);
  });

  r.delete('/orders/:id/signature', requireRole('admin'), (ctx) => {
    const id = reqId(ctx.params.id, 'ID');
    run('UPDATE orders SET signature_strokes = NULL, signed_name = NULL, signed_at = NULL WHERE id = ?', id);
  });
}
