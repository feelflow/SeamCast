import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * Minimaler ZIP-Leser und -Schreiber für Design-Pakete (ohne Zusatzpaket).
 * Unterstützt nur gespeicherte (0) und deflate-komprimierte (8) Einträge, kein ZIP64, keine Verschlüsselung.
 * Alle Größen werden begrenzt, damit kein präpariertes Archiv den Speicher füllen kann.
 */

export interface ZipLimits {
  maxEntries: number;
  /** Größe eines einzelnen entpackten Eintrags */
  maxEntryBytes: number;
  /** Summe aller entpackten Einträge */
  maxTotalBytes: number;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export class ZipError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function readZip(buffer: Buffer, limits: ZipLimits): ZipEntry[] {
  // Ende-Kennung suchen (das Archiv darf einen Kommentar am Ende haben)
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('Keine gültige ZIP-Datei.');
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || centralOffset === 0xffffffff) throw new ZipError('ZIP64 wird nicht unterstützt.');
  if (count > limits.maxEntries) throw new ZipError('Zu viele Dateien im Paket.');
  if (centralOffset + centralSize > eocd) throw new ZipError('Beschädigte ZIP-Datei.');

  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let total = 0;
  let pos = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== CENTRAL) throw new ZipError('Beschädigte ZIP-Datei.');
    const flags = buffer.readUInt16LE(pos + 8);
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const size = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const expectedCrc = buffer.readUInt32LE(pos + 16);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
    pos += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue; // Ordnereintrag
    if (flags & 1) throw new ZipError('Verschlüsselte ZIP-Dateien werden nicht unterstützt.');
    if (method !== 0 && method !== 8) throw new ZipError('Nicht unterstützte Komprimierung.');
    if (seen.has(name)) throw new ZipError('Doppelter Dateiname im Paket.');
    seen.add(name);
    if (size > limits.maxEntryBytes) throw new ZipError(`„${name.slice(0, 40)}“ ist zu groß.`);
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipError('Das Paket ist entpackt zu groß.');

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL) throw new ZipError('Beschädigte ZIP-Datei.');
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (start + compressedSize > buffer.length) throw new ZipError('Beschädigte ZIP-Datei.');
    const raw = buffer.subarray(start, start + compressedSize);
    let data: Buffer;
    try {
      // maxOutputLength schützt vor Zip-Bomben, auch wenn die angegebene Größe gelogen ist
      data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: size });
    } catch {
      throw new ZipError(`„${name.slice(0, 40)}“ lässt sich nicht entpacken.`);
    }
    if (data.length !== size || crc32(data) !== expectedCrc) throw new ZipError(`„${name.slice(0, 40)}“ ist beschädigt.`);
    entries.push({ name, data });
  }
  return entries;
}

export function writeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.data);
    const useDeflate = deflated.length < entry.data.length;
    const body = useDeflate ? deflated : entry.data;
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // Namen sind UTF-8
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(CENTRAL, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(useDeflate ? 8 : 0, 10);
    head.writeUInt32LE(checksum, 16);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(entry.data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += 30 + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuffer, end]);
}
