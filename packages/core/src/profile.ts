/** Prüfung von Grafikprofilen (Designs) vor dem Import. Rein, ohne Dateizugriff. */

export const PROFILE_ID_PATTERN = /^[a-z0-9-]{1,40}$/;
/** Bilddateien aus config/assets: reiner Dateiname, nur Bildformate. */
export const ASSET_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(png|jpe?g|webp|svg)$/i;

/** Erlaubte Abschnitte auf oberster Ebene. Alles andere wird abgelehnt. */
export const PROFILE_KEYS = [
  'name',
  'design',
  'colors',
  'font',
  'radius',
  'labels',
  'show',
  'layout',
  'cards',
  'scoreboard',
  'lineup',
  'events',
] as const;

export const PROFILE_LIMITS = { bytes: 128 * 1024, depth: 8, nodes: 4000, string: 300, array: 200, key: 60, name: 60 } as const;

export type ProfileCheck =
  | { ok: true; profile: Record<string, unknown>; assets: string[] }
  | { ok: false; error: string };

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const IMAGE_NAME = /\.(png|jpe?g|webp|svg|gif|bmp|avif)$/i;
// Zeichen und Muster, die in einem Design nichts zu suchen haben (Markup, Skripte, fremde Adressen)
// eslint-disable-next-line no-control-regex
const BAD_TEXT = /[\u0000-\u001f<>]|url\(|@import|javascript:|expression\(|:\/\//i;

const fail = (error: string): ProfileCheck => ({ ok: false, error });

/** Prüft ein hochgeladenes Profil. Gibt das (unveränderte) Profil und die genannten Bilddateien zurück. */
export function checkProfile(input: unknown): ProfileCheck {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return fail('Das Design muss ein JSON-Objekt sein.');
  const root = input as Record<string, unknown>;
  for (const key of Object.keys(root)) {
    if (!(PROFILE_KEYS as readonly string[]).includes(key)) return fail(`Unbekannter Abschnitt „${key.slice(0, 40)}“.`);
  }
  const name = root.name;
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > PROFILE_LIMITS.name) {
    return fail(`„name“ fehlt oder ist länger als ${PROFILE_LIMITS.name} Zeichen.`);
  }
  if (BAD_TEXT.test(name)) return fail('„name“ enthält ungültige Zeichen.');

  const assets = new Set<string>();
  let nodes = 0;
  const visit = (value: unknown, depth: number, where: string): string | null => {
    nodes += 1;
    if (nodes > PROFILE_LIMITS.nodes) return 'Das Design ist zu groß.';
    if (depth > PROFILE_LIMITS.depth) return `Zu tief verschachtelt bei „${where}“.`;
    if (value === null || typeof value === 'boolean') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? null : `Ungültige Zahl bei „${where}“.`;
    if (typeof value === 'string') {
      if (value.length > PROFILE_LIMITS.string) return `Text zu lang bei „${where}“.`;
      if (BAD_TEXT.test(value)) return `Ungültiger Inhalt bei „${where}“.`;
      if (IMAGE_NAME.test(value)) {
        if (!ASSET_FILE_PATTERN.test(value)) return `Bild bei „${where}“ muss ein reiner Dateiname (png, jpg, webp, svg) sein.`;
        assets.add(value);
      }
      return null;
    }
    if (Array.isArray(value)) {
      if (value.length > PROFILE_LIMITS.array) return `Liste zu lang bei „${where}“.`;
      for (let i = 0; i < value.length; i += 1) {
        const problem = visit(value[i], depth + 1, `${where}[${i}]`);
        if (problem) return problem;
      }
      return null;
    }
    if (typeof value === 'object') {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (BAD_KEYS.has(key) || key.length > PROFILE_LIMITS.key) return `Ungültiger Schlüssel bei „${where}“.`;
        const problem = visit(inner, depth + 1, where ? `${where}/${key}` : key);
        if (problem) return problem;
      }
      return null;
    }
    return `Ungültiger Wert bei „${where}“.`;
  };
  const problem = visit(root, 0, '');
  if (problem) return fail(problem);
  return { ok: true, profile: root, assets: [...assets].sort() };
}

/** Kennung aus dem Namen: Kleinbuchstaben, Ziffern und Bindestriche. */
export function profileIdFromName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'design';
}
