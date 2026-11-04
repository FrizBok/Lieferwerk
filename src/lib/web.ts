import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './validate.ts';
import type { SessionUser } from '../types.ts';

export interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: any;
  user: SessionUser | null;
  ip: string;
  /** HTTP-Status der Antwort (Standard 200) */
  status: number;
  /** Zusaetzliche Antwort-Header (z. B. Set-Cookie) */
  headers: Record<string, string | string[]>;
}

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handlers: Handler[];
}

/**
 * Minimaler Router. Alle Handler einer Route laufen nacheinander ("Guards" wie
 * requireAuth zuerst); der Rueckgabewert des letzten Handlers wird als JSON gesendet.
 */
/** Antwort mit beliebigem Inhalt (z. B. PDF, Datei-Download) statt JSON. */
export class Raw {
  body: Buffer;
  type: string;
  filename: string | null;
  attachment: boolean;
  constructor(body: Buffer | string, type: string, filename: string | null = null, attachment = false) {
    this.body = typeof body === 'string' ? Buffer.from(body) : body;
    this.type = type;
    this.filename = filename;
    this.attachment = attachment;
  }
}

export class Router {
  routes: Route[] = [];

  add(method: string, pattern: string, handlers: Handler[]): void {
    const keys: string[] = [];
    const source = pattern.replace(/:([A-Za-z_]+)/g, (_m, k: string) => {
      keys.push(k);
      return '([^/]+)';
    });
    this.routes.push({ method, re: new RegExp(`^${source}/?$`), keys, handlers });
  }

  get(p: string, ...h: Handler[]): void {
    this.add('GET', p, h);
  }
  post(p: string, ...h: Handler[]): void {
    this.add('POST', p, h);
  }
  put(p: string, ...h: Handler[]): void {
    this.add('PUT', p, h);
  }
  delete(p: string, ...h: Handler[]): void {
    this.add('DELETE', p, h);
  }

  match(method: string, p: string): { route: Route; params: Record<string, string> } | 'method' | null {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.re.exec(p);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]);
      });
      return { route, params };
    }
    return pathMatched ? 'method' : null;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function securityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new HttpError(413, 'Anfrage ist zu groß');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  const type = String(req.headers['content-type'] ?? '');
  if (!type.includes('application/json')) throw new HttpError(415, 'Nur JSON wird akzeptiert');
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed === null || typeof parsed !== 'object' ? {} : parsed;
  } catch {
    throw new HttpError(400, 'Ungültiges JSON');
  }
}

function sendJson(res: http.ServerResponse, status: number, data: unknown, headers: Ctx['headers'] = {}): void {
  const body = JSON.stringify(data);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function serveStatic(root: string, pathname: string, method: string, res: http.ServerResponse): Promise<void> {
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, `.${rel}`);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(404);
    res.end('Nicht gefunden');
    return;
  }
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
    const data = await fs.promises.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
  }
}

export interface AppOptions {
  router: Router;
  publicDir: string;
  loadUser: (req: http.IncomingMessage) => SessionUser | null;
}

export function createApp(opts: AppOptions): http.Server {
  const root = path.resolve(opts.publicDir);
  const trustProxy = process.env.TRUST_PROXY === '1';

  return http.createServer(async (req, res) => {
    try {
      securityHeaders(res);
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = (req.method ?? 'GET').toUpperCase();

      if (!url.pathname.startsWith('/api/')) {
        await serveStatic(root, url.pathname, method, res);
        return;
      }

      // CSRF-Schutz: schreibende Anfragen nur vom eigenen Host
      if (method !== 'GET' && method !== 'HEAD') {
        const origin = req.headers.origin;
        if (origin) {
          let ok = false;
          try {
            ok = new URL(origin).host === req.headers.host;
          } catch {
            ok = false;
          }
          if (!ok) throw new HttpError(403, 'Anfrage von fremder Herkunft abgelehnt');
        }
      }

      const apiPath = url.pathname.slice(4);
      const found = opts.router.match(method, apiPath);
      if (found === null) throw new HttpError(404, 'Nicht gefunden');
      if (found === 'method') throw new HttpError(405, 'Methode nicht erlaubt');

      const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
      const ctx: Ctx = {
        req,
        res,
        method,
        path: apiPath,
        query: url.searchParams,
        params: found.params,
        body: method === 'GET' || method === 'HEAD' ? {} : await readBody(req),
        user: opts.loadUser(req),
        ip: forwarded || req.socket.remoteAddress || 'unknown',
        status: 200,
        headers: {},
      };

      let result: unknown;
      for (const handler of found.route.handlers) {
        result = await handler(ctx);
      }
      if (result instanceof Raw) {
        const h: Record<string, string | number> = { 'Content-Type': result.type, 'Content-Length': result.body.length, 'Cache-Control': 'no-store' };
        if (result.filename) h['Content-Disposition'] = `${result.attachment ? 'attachment' : 'inline'}; filename="${result.filename.replace(/[^\w.\-]/g, '_')}"`;
        res.writeHead(ctx.status, h);
        res.end(ctx.method === 'HEAD' ? undefined : result.body);
        return;
      }
      sendJson(res, ctx.status, result === undefined ? { ok: true } : result, ctx.headers);
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e instanceof HttpError) {
        sendJson(res, e.status, { error: e.message });
      } else {
        console.error('Interner Fehler:', e);
        sendJson(res, 500, { error: 'Interner Serverfehler' });
      }
    }
  });
}
