import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Game, RULE_PROFILES, parseAction } from '@seamcast/core';
import { createPersistence } from './persist.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

export interface ServerOptions {
  host?: string;
  /** 0 wählt einen freien Port (für Tests) */
  port?: number;
  dataDir?: string;
  publicDir?: string;
  profilesDir?: string;
  log?: (message: string) => void;
}

export interface RunningServer {
  host: string;
  port: number;
  close(): Promise<void>;
}

type Role = 'overlay' | 'control' | 'preview';

const GRAPHIC_IDS = ['scoreboard'] as const;
type GraphicId = (typeof GRAPHIC_IDS)[number];
type Graphics = Record<GraphicId, boolean>;

const isGraphicId = (value: unknown): value is GraphicId =>
  typeof value === 'string' && (GRAPHIC_IDS as readonly string[]).includes(value);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
};

const CSP = [
  "default-src 'self'",
  "connect-src 'self' ws: wss:",
  "img-src 'self' data:",
  "media-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const PROFILE_ID = /^[a-z0-9-]{1,40}$/;

function readGraphics(saved: unknown): Graphics {
  const result: Graphics = { scoreboard: true };
  const raw = (saved as { graphics?: Record<string, unknown> } | null)?.graphics;
  if (raw && typeof raw === 'object') {
    for (const id of GRAPHIC_IDS) {
      if (typeof raw[id] === 'boolean') result[id] = raw[id];
    }
  }
  return result;
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const host = options.host ?? '127.0.0.1';
  const log = options.log ?? ((message: string) => console.log(message));
  const dataDir = options.dataDir ?? path.join(process.cwd(), 'data');
  const publicDir = path.resolve(options.publicDir ?? path.join(here, '../public'));
  const profilesDir = path.resolve(options.profilesDir ?? path.join(repoRoot, 'config/profiles'));

  let game = new Game();
  let graphics: Graphics = { scoreboard: true };

  const persistence = createPersistence(
    path.join(dataDir, 'game.json'),
    () => ({ ...game.snapshot(), graphics }),
    log,
  );

  const saved = await persistence.load();
  if (saved) {
    const restored = Game.fromSnapshot(saved);
    if (restored) {
      game = restored;
      graphics = readGraphics(saved);
      log('Spielstand aus der letzten Sitzung wiederhergestellt.');
    } else {
      log('Gespeicherter Spielstand ist ungültig und wird ignoriert.');
    }
  }

  const clients = new Map<WebSocket, Role>();
  const alive = new WeakMap<WebSocket, boolean>();

  const count = (role: Role): number => [...clients.values()].filter((r) => r === role).length;

  function snapshot() {
    return {
      type: 'snapshot',
      protocol: 1,
      game: game.state,
      canUndo: game.canUndo,
      graphics,
      status: { overlays: count('overlay'), controls: count('control') },
      rules: RULE_PROFILES,
    };
  }

  function broadcast(): void {
    const message = JSON.stringify(snapshot());
    for (const ws of clients.keys()) {
      if (ws.readyState === ws.OPEN) ws.send(message);
    }
  }

  function send(res: http.ServerResponse, status: number, body: string, type: string, head: boolean) {
    res.writeHead(status, {
      'Content-Type': type,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(head ? undefined : body);
  }

  async function serveStatic(pathname: string, res: http.ServerResponse, head: boolean) {
    const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const filePath = path.resolve(publicDir, `.${relative}`);
    if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
      return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8', head);
    }
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) {
        res.writeHead(301, { Location: `${pathname}/` });
        return res.end();
      }
      const body = await readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const type = MIME[ext] ?? 'application/octet-stream';
      const headers: http.OutgoingHttpHeaders = {
        'Content-Type': type,
        'Content-Length': body.length,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      };
      if (ext === '.html') {
        headers['Content-Security-Policy'] = CSP;
        headers['Referrer-Policy'] = 'no-referrer';
      }
      res.writeHead(200, headers);
      res.end(head ? undefined : body);
    } catch {
      send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8', head);
    }
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const head = req.method === 'HEAD';
    if (req.method !== 'GET' && !head) {
      return send(res, 405, 'Nur GET erlaubt', 'text/plain; charset=utf-8', false);
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      return send(res, 400, 'Ungültige Adresse', 'text/plain; charset=utf-8', head);
    }

    if (pathname === '/') {
      res.writeHead(302, { Location: '/control/' });
      return res.end();
    }
    if (pathname === '/api/state') {
      return send(res, 200, JSON.stringify(snapshot()), MIME['.json']!, head);
    }
    const profileMatch = /^\/api\/profiles\/([^/]+)$/.exec(pathname);
    if (profileMatch) {
      const id = profileMatch[1] ?? '';
      if (!PROFILE_ID.test(id)) {
        return send(res, 404, 'Profil nicht gefunden', 'text/plain; charset=utf-8', head);
      }
      try {
        const profile: unknown = JSON.parse(await readFile(path.join(profilesDir, `${id}.json`), 'utf8'));
        return send(res, 200, JSON.stringify(profile), MIME['.json']!, head);
      } catch {
        return send(res, 404, 'Profil nicht gefunden', 'text/plain; charset=utf-8', head);
      }
    }
    return serveStatic(pathname, res, head);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      log(`Fehler bei ${req.url}: ${String(error)}`);
      if (!res.headersSent) send(res, 500, 'Interner Fehler', 'text/plain; charset=utf-8', false);
      else res.end();
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  /** Browser dürfen nur von der eigenen Seite aus verbinden (Schutz vor fremden Webseiten). */
  function sameOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  server.on('upgrade', (req, socket, headBuffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws' || !sameOrigin(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const requested = url.searchParams.get('role');
    const role: Role = requested === 'control' || requested === 'preview' ? requested : 'overlay';
    wss.handleUpgrade(req, socket, headBuffer, (ws) => onConnection(ws, role));
  });

  function onConnection(ws: WebSocket, role: Role): void {
    clients.set(ws, role);
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', (data) => onMessage(ws, role, data.toString()));
    ws.on('close', () => {
      clients.delete(ws);
      broadcast();
    });
    ws.on('error', () => ws.terminate());
    broadcast();
  }

  function onMessage(ws: WebSocket, role: Role, raw: string): void {
    if (role !== 'control') return;
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return reject(ws);
    }
    if (typeof message !== 'object' || message === null) return reject(ws);
    const input = message as Record<string, unknown>;

    let changed = false;
    switch (input.type) {
      case 'action': {
        const action = parseAction(input.action);
        if (!action) return reject(ws);
        changed = game.dispatch(action);
        break;
      }
      case 'undo':
        changed = game.undo();
        break;
      case 'graphics':
        if (!isGraphicId(input.id) || typeof input.visible !== 'boolean') return reject(ws);
        changed = graphics[input.id] !== input.visible;
        graphics = { ...graphics, [input.id]: input.visible };
        break;
      case 'hideAll':
        changed = Object.values(graphics).some(Boolean);
        graphics = Object.fromEntries(GRAPHIC_IDS.map((id) => [id, false])) as Graphics;
        break;
      default:
        return reject(ws);
    }
    if (changed) {
      persistence.save();
      broadcast();
    }
  }

  function reject(ws: WebSocket): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message: 'Ungültige Eingabe' }));
  }

  // Tote Verbindungen entfernen, damit die Zahl der verbundenen Overlays stimmt.
  const heartbeat = setInterval(() => {
    for (const ws of clients.keys()) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
    // Regelmäßiger Stand als Lebenszeichen: Overlays blenden sich aus, wenn er ausbleibt.
    broadcast();
  }, 15_000);
  heartbeat.unref();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8080, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 8080);

  return {
    host,
    port,
    async close() {
      clearInterval(heartbeat);
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      await persistence.flush();
    },
  };
}
