import zlib from 'node:zlib';

/**
 * Minimaler PDF-Writer ohne Abhaengigkeiten: A4, Helvetica (WinAnsi), Text, Linien, Rechtecke.
 * Koordinaten in Punkt, Ursprung oben links (intern auf PDF umgerechnet).
 */
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;

const WIN1252: Record<string, number> = { '€': 0x80, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };

function encode(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const byte = WIN1252[ch] ?? (code <= 0xff && !(code >= 0x80 && code <= 0x9f) ? code : 0x3f);
    out += byte.toString(16).padStart(2, '0');
  }
  return `<${out}>`;
}

// Helvetica-Zeichenbreiten (1/1000 em) fuer haeufige Zeichen
const W: Record<string, number> = {};
const widths: [string, number][] = [
  [' .,:;/!|', 278], ['-()[]', 333], ['0123456789abdeghnopqu', 556], ['cksvxyz', 500], ['fjt', 278], ['ilI', 222], ['r', 333],
  ['m', 833], ['w', 722], ['ABCDHNRUÄÜ', 722], ['EKPSVXY', 667], ['FTZ', 611], ['GOQÖ', 778], ['L', 556], ['M', 833], ['W', 944],
  ['%', 889], ['&', 667], ['+=', 584], ['€', 556], ['äöüß', 556], ['J', 500],
];
for (const [chars, w] of widths) for (const ch of chars) W[ch] = w;

export function textWidth(text: string, size: number, bold = false): number {
  let sum = 0;
  for (const ch of text) sum += W[ch] ?? 556;
  return (sum / 1000) * size * (bold ? 1.06 : 1);
}

export function fitText(text: string, size: number, maxWidth: number, bold = false): string {
  if (textWidth(text, size, bold) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && textWidth(t + '…', size, bold) > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

export function wrapText(text: string, size: number, maxWidth: number, bold = false): string[] {
  const lines: string[] = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (textWidth(test, size, bold) <= maxWidth || !line) line = test;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

export class PdfPage {
  ops: string[] = [];
  text(x: number, y: number, s: string, size = 10, bold = false, gray = 0): void {
    this.ops.push(`BT ${gray} g /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${(PAGE_H - y).toFixed(2)} Td ${encode(s)} Tj ET`);
  }
  textRight(xRight: number, y: number, s: string, size = 10, bold = false, gray = 0): void {
    this.text(xRight - textWidth(s, size, bold), y, s, size, bold, gray);
  }
  line(x1: number, y1: number, x2: number, y2: number, width = 0.6, gray = 0.6): void {
    this.ops.push(`${gray} G ${width} w ${x1.toFixed(2)} ${(PAGE_H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_H - y2).toFixed(2)} l S`);
  }
  rect(x: number, y: number, w: number, h: number, fillGray: number | null, strokeGray: number | null = null): void {
    const fill = fillGray !== null ? `${fillGray} g ` : '';
    const stroke = strokeGray !== null ? `${strokeGray} G 0.6 w ` : '';
    const op = fillGray !== null && strokeGray !== null ? 'B' : fillGray !== null ? 'f' : 'S';
    this.ops.push(`${fill}${stroke}${x.toFixed(2)} ${(PAGE_H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${op}`);
  }
  /** Freihand-Striche (Punkte in Punkt-Koordinaten oben links). */
  strokes(strokes: [number, number][][], width = 1.4): void {
    const parts: string[] = [`0.1 G ${width} w 1 J 1 j`];
    for (const s of strokes) {
      if (!s.length) continue;
      const pts = s.length === 1 ? [s[0], [s[0][0] + 0.1, s[0][1]] as [number, number]] : s;
      parts.push(pts.map(([x, y], i) => `${x.toFixed(2)} ${(PAGE_H - y).toFixed(2)} ${i === 0 ? 'm' : 'l'}`).join(' ') + ' S');
    }
    this.ops.push(parts.join(' '));
  }
}

export function buildPdf(pages: PdfPage[], title = 'Dokument'): Buffer {
  const objects: Buffer[] = [];
  const add = (body: string | Buffer): number => {
    objects.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body);
    return objects.length;
  };
  const catalogId = add('');
  const pagesId = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  for (const p of pages) {
    const data = zlib.deflateSync(Buffer.from(p.ops.join('\n'), 'latin1'));
    const contentId = add(Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]));
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  const infoId = add(`<< /Title ${encode(title)} /Producer (Lieferwerk) >>`);
  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'latin1');
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`, 'latin1');

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let pos = chunks[0].length;
  objects.forEach((obj, i) => {
    offsets.push(pos);
    const buf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), obj, Buffer.from('\nendobj\n', 'latin1')]);
    chunks.push(buf);
    pos += buf.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}
