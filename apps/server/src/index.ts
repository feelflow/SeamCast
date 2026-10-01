import path from 'node:path';
import { startServer } from './server.js';

const host = process.env.SEAMCAST_HOST ?? '127.0.0.1';
const port = Number(process.env.SEAMCAST_PORT ?? 8080);
const dataDir = process.env.SEAMCAST_DATA ?? path.join(process.cwd(), 'data');

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Ungültiger Port: ${process.env.SEAMCAST_PORT}`);
  process.exit(1);
}

const server = await startServer({ host, port, dataDir });

const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
console.log(`SeamCast läuft auf http://${shown}:${server.port}`);
console.log(`  Bedienung:  http://${shown}:${server.port}/control/`);
console.log(`  Scoreboard: http://${shown}:${server.port}/overlay/scoreboard.html`);
console.log(`  Daten:      ${dataDir}`);
if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
  console.warn(
    'Achtung: SeamCast ist im Netzwerk erreichbar, hat aber noch keine Anmeldung. Nur in vertrauenswürdigen Netzen betreiben.',
  );
}

async function shutdown() {
  await server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
