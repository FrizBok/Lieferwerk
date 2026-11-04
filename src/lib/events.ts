import type http from 'node:http';

/**
 * Live-Aktualisierung per Server-Sent Events: Nach jeder erfolgreichen Aenderung bekommen alle
 * verbundenen Browser einen "change"-Hinweis (ohne Daten) und laden ihre Ansicht danach selbst
 * ueber die normale, berechtigte API neu. So gelangen keine Inhalte an Unbefugte.
 */
const clients = new Set<http.ServerResponse>();
const MAX_CLIENTS = 300;

export function openStream(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (clients.size >= MAX_CLIENTS) return false;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n: verbunden\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
  return true;
}

export function broadcastChange(): void {
  const msg = `event: change\ndata: ${Date.now()}\n\n`;
  for (const c of clients) {
    try { c.write(msg); } catch { clients.delete(c); }
  }
}

export function closeAllStreams(): void {
  for (const c of clients) {
    try { c.end(); } catch { /* egal */ }
  }
  clients.clear();
}

export function streamCount(): number {
  return clients.size;
}

// Herzschlag haelt die Verbindung durch Proxys offen
setInterval(() => {
  for (const c of clients) {
    try { c.write(': ping\n\n'); } catch { clients.delete(c); }
  }
}, 25_000).unref();
