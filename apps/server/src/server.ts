import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Game, RULE_PROFILES, battingSide, fieldingSide, parseAction, parsePlayerInput, parseTeamInput } from '@seamcast/core';
import { createRepo, openDatabase } from './db.js';
import { buildLineup, currentBatterId, currentPitcherId, emptyLineups, parseSlots, readLineups, withPitcher, type Lineups } from './lineup.js';
import { buildCard, emptyMatchup, readMatchup, type Matchup } from './cards.js';
import { importFromAccess } from './importer.js';
import { statLines } from './statlines.js';
import { createPersistence } from './persist.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

export interface ServerOptions {
  host?: string;
  /** 0 wählt einen freien Port (für Tests) */
  port?: number;
  dataDir?: string;
  /** Pfad der SQLite-Datei; Standard: seamcast.db im Datenordner */
  dbFile?: string;
  publicDir?: string;
  profilesDir?: string;
  assetsDir?: string;
  log?: (message: string) => void;
}

export interface RunningServer {
  host: string;
  port: number;
  close(): Promise<void>;
}

type Role = 'overlay' | 'control' | 'preview';

const GRAPHIC_IDS = ['scoreboard', 'batter', 'pitcher', 'lineupAway', 'lineupHome'] as const;
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

/** Bilddateien aus config/assets (z. B. Sponsor-Logos): reiner Dateiname, nur Bildformate. */
const ASSET_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(png|jpe?g|webp|svg)$/i;

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

/** Alle Grafikprofile im Ordner: Kennung und Anzeigename. */
async function listProfiles(dir: string): Promise<Array<{ id: string; name: string }>> {
  const result: Array<{ id: string; name: string }> = [];
  let files: string[] = [];
  try {
    files = (await readdir(dir)).sort();
  } catch {
    return [{ id: 'default', name: 'Standard' }];
  }
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    if (!file.endsWith('.json') || !PROFILE_ID.test(id)) continue;
    try {
      const parsed = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as { name?: unknown };
      result.push({ id, name: typeof parsed.name === 'string' ? parsed.name : id });
    } catch {
      // kaputte Profildatei überspringen
    }
  }
  return result.length ? result : [{ id: 'default', name: 'Standard' }];
}

/** Grafiken, für die ein eigenes Layout (Profil) gewählt werden kann. Die Aufstellung (Gast/Heim) teilt sich eines. */
const LAYOUT_TARGETS = ['scoreboard', 'batter', 'pitcher', 'lineup'] as const;
type LayoutTarget = (typeof LAYOUT_TARGETS)[number];
/** Profilkennung je Grafik; null = folgt dem Grundprofil. */
type Layouts = Record<LayoutTarget, string | null>;

const emptyLayouts = (): Layouts => ({ scoreboard: null, batter: null, pitcher: null, lineup: null });

function readLayouts(saved: unknown, known: Array<{ id: string }>): Layouts {
  const result = emptyLayouts();
  const raw = (saved as { layouts?: Record<string, unknown> } | null)?.layouts;
  if (raw && typeof raw === 'object') {
    for (const target of LAYOUT_TARGETS) {
      const id = raw[target];
      if (typeof id === 'string' && known.some((x) => x.id === id)) result[target] = id;
    }
  }
  return result;
}

function readGraphics(saved: unknown): Graphics {
  const result: Graphics = { scoreboard: true, batter: false, pitcher: false, lineupAway: false, lineupHome: false };
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
  const assetsDir = path.resolve(options.assetsDir ?? path.join(repoRoot, 'config/assets'));

  let game = new Game();
  let graphics: Graphics = { scoreboard: true, batter: false, pitcher: false, lineupAway: false, lineupHome: false };
  let matchup: Matchup = emptyMatchup();
  let lineups: Lineups = emptyLineups();
  let profileId = 'default';
  let layouts: Layouts = emptyLayouts();
  const profileList = await listProfiles(profilesDir);

  const persistence = createPersistence(
    path.join(dataDir, 'game.json'),
    () => ({ ...game.snapshot(), graphics, matchup, lineups, profile: profileId, layouts }),
    log,
  );

  const saved = await persistence.load();
  if (saved) {
    const restored = Game.fromSnapshot(saved);
    if (restored) {
      game = restored;
      graphics = readGraphics(saved);
      matchup = readMatchup(saved);
      lineups = readLineups(saved);
      const savedProfile = (saved as { profile?: unknown }).profile;
      if (typeof savedProfile === 'string' && profileList.some((x) => x.id === savedProfile)) profileId = savedProfile;
      layouts = readLayouts(saved, profileList);
      log('Spielstand aus der letzten Sitzung wiederhergestellt.');
    } else {
      log('Gespeicherter Spielstand ist ungültig und wird ignoriert.');
    }
  }

  const db = openDatabase(options.dbFile ?? path.join(dataDir, 'seamcast.db'));
  const repo = createRepo(db);

  const clients = new Map<WebSocket, Role>();
  const alive = new WeakMap<WebSocket, boolean>();

  const count = (role: Role): number => [...clients.values()].filter((r) => r === role).length;

  /** Wer gerade schlägt/pitcht: aus der Aufstellung, sonst von Hand gewählt (Auswahl). */
  function currentPlayers() {
    const bat = battingSide(game.state);
    const field = fieldingSide(game.state);
    const lineupBatter = currentBatterId(lineups[bat], game.state.batterIndex[bat]);
    const lineupPitcher = currentPitcherId(lineups[field]);
    return {
      batterId: lineupBatter ?? matchup.batter[bat],
      pitcherId: lineupPitcher ?? matchup.pitcher[field],
      auto: { batter: lineupBatter !== null, pitcher: lineupPitcher !== null },
    };
  }

  function snapshot() {
    const now = currentPlayers();
    return {
      type: 'snapshot',
      protocol: 1,
      game: game.state,
      canUndo: game.canUndo,
      graphics,
      matchup,
      cards: {
        batter: buildCard(repo, 'batter', now.batterId, lineups),
        pitcher: buildCard(repo, 'pitcher', now.pitcherId, lineups),
      },
      current: now,
      profile: profileId,
      layouts,
      profiles: profileList,
      lineups: { away: buildLineup(repo, lineups.away), home: buildLineup(repo, lineups.home) },
      status: { overlays: count('overlay'), controls: count('control') },
      rules: RULE_PROFILES,
    };
  }

  let closing = false;

  function broadcast(): void {
    if (closing) return;
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

  const json = (res: http.ServerResponse, status: number, body: unknown) =>
    send(res, status, JSON.stringify(body), MIME['.json']!, false);

  async function readJson(req: http.IncomingMessage): Promise<unknown> {
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new Error('content-type');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > 16 * 1024) throw new Error('too large');
      chunks.push(chunk as Buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  async function readBinary(req: http.IncomingMessage, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > limit) throw new Error('too large');
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  /** Spielerstatistik und Import: /api/players/<id>/stats, POST /api/import/access */
  async function handleData(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    search: URLSearchParams,
  ): Promise<boolean> {
    const stats = /^\/api\/players\/(\d+)\/stats$/.exec(pathname);
    if (stats && (req.method === 'GET' || req.method === 'HEAD')) {
      json(res, 200, statLines(repo.playerStats(Number(stats[1]))));
      return true;
    }
    if (pathname !== '/api/import/access') return false;
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Methode nicht erlaubt' });
      return true;
    }
    if (!sameOrigin(req)) {
      json(res, 403, { error: 'Fremde Herkunft' });
      return true;
    }
    let file: Buffer;
    try {
      file = await readBinary(req, 50 * 1024 * 1024);
    } catch {
      json(res, 413, { error: 'Datei ist zu groß (mehr als 50 MB)' });
      return true;
    }
    try {
      json(res, 200, importFromAccess(db, file, search.get('dryRun') === '1'));
    } catch (error) {
      log(`Import fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
      json(res, 400, { error: 'Die Datei konnte nicht gelesen werden. Ist es die Access-Datei (.accdb) des HTV-Managers?' });
    }
    return true;
  }

  /** Kader-Schnittstelle: /api/teams und /api/players. Gibt true zurück, wenn die Adresse dazugehört. */
  async function handleRoster(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    search: URLSearchParams,
  ): Promise<boolean> {
    const match = /^\/api\/(teams|players)(?:\/(\d+))?$/.exec(pathname);
    if (!match) return false;
    const kind = match[1] as 'teams' | 'players';
    const id = match[2] === undefined ? undefined : Number(match[2]);
    const method = req.method ?? 'GET';

    if (method === 'GET' || method === 'HEAD') {
      if (id !== undefined) {
        json(res, 404, { error: 'Nicht gefunden' });
      } else if (kind === 'teams') {
        json(res, 200, repo.listTeams());
      } else {
        const team = search.get('team');
        const teamId = team === null ? undefined : Number(team);
        if (teamId !== undefined && !Number.isInteger(teamId)) json(res, 400, { error: 'Ungültige Mannschaft' });
        else json(res, 200, repo.listPlayers(teamId));
      }
      return true;
    }

    if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
      json(res, 405, { error: 'Methode nicht erlaubt' });
      return true;
    }
    // Schreibzugriffe nur von der eigenen Seite (Schutz vor fremden Webseiten)
    if (!sameOrigin(req)) {
      json(res, 403, { error: 'Fremde Herkunft' });
      return true;
    }
    if ((method === 'POST') === (id !== undefined)) {
      json(res, 404, { error: 'Nicht gefunden' });
      return true;
    }

    if (method === 'DELETE') {
      const deleted = kind === 'teams' ? repo.deleteTeam(id as number) : repo.deletePlayer(id as number);
      json(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: 'Nicht gefunden' });
      return true;
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      json(res, 400, { error: 'Ungültige Eingabe' });
      return true;
    }
    const failures = {
      conflict: [409, 'Gibt es schon'],
      notFound: [404, 'Nicht gefunden'],
      badTeam: [400, 'Mannschaft existiert nicht'],
    } as const;
    const answer = (outcome: ReturnType<typeof repo.createPlayer> | ReturnType<typeof repo.updateTeam>) => {
      if (outcome.ok) json(res, method === 'POST' ? 201 : 200, outcome.value);
      else json(res, failures[outcome.reason][0], { error: failures[outcome.reason][1] });
    };

    if (kind === 'teams') {
      const input = parseTeamInput(body);
      if (!input) json(res, 400, { error: 'Ungültige Eingabe' });
      else answer(method === 'POST' ? repo.createTeam(input) : repo.updateTeam(id as number, input));
    } else {
      const input = parsePlayerInput(body);
      if (!input) json(res, 400, { error: 'Ungültige Eingabe' });
      else answer(method === 'POST' ? repo.createPlayer(input) : repo.updatePlayer(id as number, input));
    }
    return true;
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const head = req.method === 'HEAD';
    let pathname: string;
    let search: URLSearchParams;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
      search = url.searchParams;
    } catch {
      return send(res, 400, 'Ungültige Adresse', 'text/plain; charset=utf-8', head);
    }
    if (await handleData(req, res, pathname, search)) return;
    if (await handleRoster(req, res, pathname, search)) return;
    if (req.method !== 'GET' && !head) {
      return send(res, 405, 'Nur GET erlaubt', 'text/plain; charset=utf-8', false);
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
    const assetMatch = /^\/assets\/([^/]+)$/.exec(pathname);
    if (assetMatch) {
      const name = assetMatch[1] ?? '';
      if (!ASSET_FILE.test(name)) {
        return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8', head);
      }
      try {
        const body = await readFile(path.join(assetsDir, name));
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': body.length,
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        });
        return res.end(head ? undefined : body);
      } catch {
        return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8', head);
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
      case 'select': {
        const side = input.side;
        const playerId = input.playerId;
        if ((input.role !== 'batter' && input.role !== 'pitcher') || (side !== 'away' && side !== 'home')) return reject(ws);
        if (playerId !== null && (typeof playerId !== 'number' || !Number.isInteger(playerId) || !repo.getPlayer(playerId))) {
          return reject(ws);
        }
        changed = matchup[input.role][side] !== playerId;
        matchup = { ...matchup, [input.role]: { ...matchup[input.role], [side]: playerId } };
        break;
      }
      case 'pitcher': {
        const side = input.side;
        const playerId = input.playerId;
        if (side !== 'away' && side !== 'home') return reject(ws);
        if (typeof playerId !== 'number' || !Number.isInteger(playerId) || !repo.getPlayer(playerId)) return reject(ws);
        const slots = withPitcher(lineups[side], playerId);
        if (!slots) return reject(ws);
        const isNew = currentPitcherId(lineups[side]) !== playerId;
        lineups = { ...lineups, [side]: slots };
        matchup = { ...matchup, pitcher: { ...matchup.pitcher, [side]: playerId } };
        // Neuer Pitcher beginnt bei 0 Würfen.
        if (isNew) game.dispatch({ type: 'adjustPitches', side, delta: -game.state.pitches[side] });
        changed = true;
        break;
      }
      case 'lineup': {
        const side = input.side;
        const slots = parseSlots(input.slots);
        if ((side !== 'away' && side !== 'home') || !slots || slots.some((x) => !repo.getPlayer(x.playerId))) return reject(ws);
        changed = JSON.stringify(lineups[side]) !== JSON.stringify(slots);
        // Anderer Pitcher in der Aufstellung = Pitcherwechsel: Würfe dieser Mannschaft starten bei 0.
        const before = currentPitcherId(lineups[side]);
        const after = currentPitcherId(slots);
        lineups = { ...lineups, [side]: slots };
        if (before !== null && after !== null && before !== after && game.state.pitches[side] > 0) {
          game.dispatch({ type: 'adjustPitches', side, delta: -game.state.pitches[side] });
        }
        break;
      }
      case 'profile': {
        if (typeof input.id !== 'string' || !profileList.some((x) => x.id === input.id)) return reject(ws);
        changed = profileId !== input.id;
        profileId = input.id;
        break;
      }
      case 'layout': {
        const target = input.graphic;
        const id = input.id;
        if (typeof target !== 'string' || !(LAYOUT_TARGETS as readonly string[]).includes(target)) return reject(ws);
        if (id !== null && (typeof id !== 'string' || !profileList.some((x) => x.id === id))) return reject(ws);
        changed = layouts[target as LayoutTarget] !== id;
        layouts = { ...layouts, [target]: id };
        break;
      }
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
      closing = true;
      clearInterval(heartbeat);
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      await persistence.flush();
      db.close();
    },
  };
}
