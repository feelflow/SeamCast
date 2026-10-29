import { ASSET_FILE_PATTERN } from '@seamcast/core';
import { ZipError, readZip, writeZip, type ZipLimits } from './zip.js';

/** Ein Design-Paket ist eine ZIP-Datei: `design.json` (das Profil) und `assets/<Bilddatei>`. Kein Code, keine Schriften. */
export const PACKAGE_LIMITS: ZipLimits & { maxZipBytes: number; maxNameLength: number } = {
  maxEntries: 40,
  maxEntryBytes: 4 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxZipBytes: 20 * 1024 * 1024,
  maxNameLength: 30,
};

const PROFILE_ENTRY = 'design.json';
const ASSET_PREFIX = 'assets/';

type Kind = 'png' | 'jpg' | 'webp' | 'svg';
const kindOfName = (name: string): Kind | null => {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return ext === 'png' ? 'png' : ext === 'jpg' || ext === 'jpeg' ? 'jpg' : ext === 'webp' ? 'webp' : ext === 'svg' ? 'svg' : null;
};

/** Prüft, dass der Inhalt wirklich zum Dateityp passt; bei SVG zusätzlich, dass nichts Ausführbares drinsteht. Gibt eine Fehlermeldung oder null zurück. */
export function checkImage(name: string, data: Buffer): string | null {
  const kind = kindOfName(name);
  if (!kind) return `„${name}“ ist kein erlaubtes Bildformat.`;
  const starts = (bytes: number[]) => bytes.every((b, i) => data[i] === b);
  const ok =
    (kind === 'png' && starts([0x89, 0x50, 0x4e, 0x47])) ||
    (kind === 'jpg' && starts([0xff, 0xd8, 0xff])) ||
    (kind === 'webp' && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') ||
    (kind === 'svg' && /<svg[\s>]/i.test(data.subarray(0, 2048).toString('utf8')));
  if (!ok) return `„${name}“ ist keine gültige ${kind.toUpperCase()}-Datei.`;
  if (kind === 'svg') {
    const text = data.toString('utf8');
    if (/<script|<foreignObject|<iframe|<embed|<object|\son\w+\s*=|javascript:|(?:href|src)\s*=\s*["']?\s*(?:https?:|\/\/|data:)|@import|url\(\s*["']?\s*(?:https?:|\/\/)/i.test(text)) {
      return `„${name}“ enthält Inhalte, die in einem Design nicht erlaubt sind.`;
    }
  }
  return null;
}

export type ReadPackage = { ok: true; profile: unknown; images: Map<string, Buffer> } | { ok: false; error: string };

export function readDesignPackage(buffer: Buffer): ReadPackage {
  if (buffer.length > PACKAGE_LIMITS.maxZipBytes) return { ok: false, error: 'Das Paket ist zu groß.' };
  let entries;
  try {
    entries = readZip(buffer, PACKAGE_LIMITS);
  } catch (error) {
    return { ok: false, error: error instanceof ZipError ? error.message : 'Keine gültige ZIP-Datei.' };
  }
  let profileData: Buffer | null = null;
  const images = new Map<string, Buffer>();
  for (const { name, data } of entries) {
    if (name === PROFILE_ENTRY) {
      profileData = data;
    } else if (name.startsWith(ASSET_PREFIX)) {
      const file = name.slice(ASSET_PREFIX.length);
      if (!ASSET_FILE_PATTERN.test(file) || file.length > PACKAGE_LIMITS.maxNameLength) {
        return { ok: false, error: `Ungültiger Bildname „${file.slice(0, 40)}“ (höchstens ${PACKAGE_LIMITS.maxNameLength} Zeichen, nur Buchstaben, Ziffern, Punkt, Bindestrich).` };
      }
      const problem = checkImage(file, data);
      if (problem) return { ok: false, error: problem };
      images.set(file, data);
    } else {
      return { ok: false, error: `Unerwartete Datei im Paket: „${name.slice(0, 40)}“. Erlaubt sind nur design.json und assets/<Bild>.` };
    }
  }
  if (!profileData) return { ok: false, error: 'Im Paket fehlt die Datei design.json.' };
  if (profileData.length > 128 * 1024) return { ok: false, error: 'design.json ist zu groß.' };
  try {
    return { ok: true, profile: JSON.parse(profileData.toString('utf8')) as unknown, images };
  } catch {
    return { ok: false, error: 'design.json ist keine gültige JSON-Datei.' };
  }
}

/** Ersetzt jede Zeichenkette, die genau einem Namen aus `rename` entspricht (rekursiv, ohne das Original zu verändern). */
export function renameAssets(value: unknown, rename: (name: string) => string | null): unknown {
  if (typeof value === 'string') return rename(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => renameAssets(item, rename));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, renameAssets(v, rename)]));
  }
  return value;
}

export function buildDesignPackage(profile: unknown, images: Map<string, Buffer>): Buffer {
  return writeZip([
    { name: PROFILE_ENTRY, data: Buffer.from(JSON.stringify(profile, null, 2), 'utf8') },
    ...[...images].map(([name, data]) => ({ name: `${ASSET_PREFIX}${name}`, data })),
  ]);
}
