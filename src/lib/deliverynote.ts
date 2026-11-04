import { buildPdf, fitText, PAGE_H, PAGE_W, PdfPage, wrapText } from './pdf.ts';
import { fmtDate } from './util.ts';

const M = 48; // Seitenrand
const eur = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;
const qty = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

export interface NoteData {
  order: any;
  items: any[];
  company: { name: string; address: string; phone: string };
  strokes: [number, number][][] | null;
  showDeposit: boolean;
}

export function buildDeliveryNote(d: NoteData): Buffer {
  const { order: o, items } = d;
  const pages: PdfPage[] = [];
  let p = new PdfPage();
  let y = 0;
  const right = PAGE_W - M;

  function header(): void {
    p.text(M, 54, 'Lieferschein', 22, true);
    p.textRight(right, 50, `Nr. ${o.number}`, 12, true);
    p.textRight(right, 66, `Lieferdatum: ${fmtDate(o.delivery_date) || '–'}`, 10);
    p.line(M, 78, right, 78, 1.2, 0.2);
    y = 100;
  }
  header();

  // Absender / Empfänger
  const company = [d.company.name, d.company.address, d.company.phone].filter(Boolean);
  p.text(M, y, 'Absender', 8, false, 0.45);
  p.text(PAGE_W / 2, y, 'Lieferadresse', 8, false, 0.45);
  y += 14;
  let ly = y;
  (company.length ? company : ['–']).forEach((line, i) => { p.text(M, ly, fitText(line, 10, 230, i === 0), 10, i === 0); ly += 14; });
  let ry = y;
  const addr = [o.customer_name, o.address, [o.postal_code, o.city].filter(Boolean).join(' '), o.phone ? `Tel. ${o.phone}` : ''].filter(Boolean);
  addr.forEach((line, i) => { p.text(PAGE_W / 2, ry, fitText(line, 10, right - PAGE_W / 2, i === 0), 10, i === 0); ry += 14; });
  y = Math.max(ly, ry) + 10;

  const meta = [
    o.time_window ? `Zeitfenster: ${o.time_window}` : '',
    o.driver_name ? `Fahrer: ${o.driver_name}` : '',
    [o.vehicle_plate && `Fahrzeug: ${o.vehicle_plate}`, o.trailer_plate && `Anhänger: ${o.trailer_plate}`].filter(Boolean).join('   '),
  ].filter(Boolean);
  if (meta.length) { p.text(M, y, meta.join('     '), 9, false, 0.3); y += 16; }
  if (o.notes) {
    for (const line of wrapText(`Hinweis: ${o.notes}`, 9, right - M)) { p.text(M, y, line, 9, false, 0.3); y += 12; }
    y += 4;
  }
  y += 6;

  // Tabelle
  const cols = { pos: M + 4, name: M + 30, qty: 345, pack: 395, dep: right - 4 };
  function tableHead(): void {
    p.rect(M, y - 12, right - M, 20, 0.93);
    p.text(cols.pos, y + 1, 'Pos.', 9, true);
    p.text(cols.name, y + 1, 'Artikel', 9, true);
    p.textRight(cols.qty + 40, y + 1, 'Menge', 9, true);
    p.text(cols.pack, y + 1, 'Verpackung', 9, true);
    if (d.showDeposit) p.textRight(cols.dep, y + 1, 'Pfand', 9, true);
    y += 20;
  }
  tableHead();
  items.forEach((it, i) => {
    const nameLines = wrapText(it.name, 10, cols.qty - cols.name - 8);
    const extra: string[] = [];
    if (it.note) extra.push(...wrapText(`Hinweis: ${it.note}`, 8.5, cols.qty - cols.name - 8));
    const h = (nameLines.length + extra.length) * 13 + 8;
    if (y + h > PAGE_H - 170) {
      pages.push(p); p = new PdfPage(); header(); tableHead();
    }
    p.text(cols.pos, y, String(i + 1), 10);
    nameLines.forEach((l, k) => p.text(cols.name, y + k * 13, l, 10));
    extra.forEach((l, k) => p.text(cols.name, y + (nameLines.length + k) * 13, l, 8.5, false, 0.4));
    p.textRight(cols.qty + 40, y, `${qty(it.quantity)} ${it.unit}`, 10);
    p.text(cols.pack, y, it.packaging === 'kasten' ? 'Kasten' : 'einzeln', 10);
    if (d.showDeposit) p.textRight(cols.dep, y, it.deposit_cents ? eur(it.deposit_cents) : '–', 10);
    y += h;
    p.line(M, y - 9, right, y - 9, 0.4, 0.85);
  });
  if (!items.length) { p.text(cols.name, y, 'Keine Positionen', 10, false, 0.5); y += 20; }

  if (d.showDeposit) {
    const total = items.reduce((s, it) => s + (it.deposit_cents || 0), 0);
    y += 4;
    p.text(cols.pack, y, 'Pfand gesamt', 10, true);
    p.textRight(cols.dep, y, eur(total), 10, true);
    y += 22;
  }

  // Unterschrift
  if (y > PAGE_H - 140) { pages.push(p); p = new PdfPage(); header(); }
  y = Math.max(y + 10, PAGE_H - 150);
  p.text(M, y, 'Ware vollständig und unbeschädigt erhalten', 9, false, 0.3);
  y += 8;
  const boxW = 240, boxH = 80;
  p.rect(M, y, boxW, boxH, null, 0.6);
  if (d.strokes && d.strokes.length) {
    p.strokes(d.strokes.map((s) => s.map(([sx, sy]) => [M + 4 + sx * (boxW - 8), y + 4 + sy * (boxH - 8)] as [number, number])));
  }
  const sx = M + boxW + 24;
  if (o.signed_at) {
    p.text(sx, y + 20, 'Unterschrieben von', 8, false, 0.45);
    p.text(sx, y + 34, fitText(o.signed_name || '', 11, right - sx, true), 11, true);
    p.text(sx, y + 52, `am ${String(o.signed_at).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1').slice(0, 16)} Uhr`, 9, false, 0.3);
  } else {
    p.text(sx, y + 20, 'Name (Druckbuchstaben)', 8, false, 0.45);
    p.line(sx, y + 46, right, y + 46, 0.6, 0.5);
    p.text(sx, y + 62, 'Datum', 8, false, 0.45);
    p.line(sx + 34, y + 66, right, y + 66, 0.6, 0.5);
  }
  p.text(M, y + boxH + 14, 'Unterschrift des Empfängers', 8, false, 0.45);
  pages.push(p);
  pages.forEach((pg, i) => pg.textRight(right, PAGE_H - 24, `Seite ${i + 1} von ${pages.length}`, 8, false, 0.5));
  return buildPdf(pages, `Lieferschein ${o.number}`);
}
