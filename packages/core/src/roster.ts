/**
 * Mannschaften und Spieler (Kader). Reine Typen und Prüfung der Eingaben;
 * die Speicherung liegt im Server.
 */
export interface TeamInput {
  name: string;
  short: string;
  league: string;
  /** Nur ein Dateiname, kein Pfad */
  logo: string;
  /** Eigene Mannschaft (z. B. die Heideköpfe) */
  own: boolean;
}

export interface Team extends TeamInput {
  id: number;
}

export type Bats = 'L' | 'R' | 'S' | '';
export type Throws = 'L' | 'R' | '';

export interface PlayerInput {
  teamId: number;
  lastName: string;
  firstName: string;
  /** Trikotnummer; null, wenn unbekannt */
  number: number | null;
  nationality: string;
  bats: Bats;
  throws: Throws;
  /** Spieler-ID des Ligadienstes; leer, wenn es keine gibt */
  externalId: string;
}

export interface Player extends PlayerInput {
  id: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Entfernt Steuerzeichen, kürzt Leerraum und prüft die Länge. */
function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.length >= min && cleaned.length <= max ? cleaned : null;
}

const LOGO_FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;

export function parseTeamInput(input: unknown): TeamInput | null {
  if (!isObject(input)) return null;
  const name = text(input.name, 1, 60);
  const short = text(input.short, 1, 6);
  const league = text(input.league ?? '', 0, 60);
  const logo = text(input.logo ?? '', 0, 100);
  if (name === null || short === null || league === null || logo === null) return null;
  if (logo !== '' && (!LOGO_FILE.test(logo) || logo.includes('..'))) return null;
  if (typeof (input.own ?? false) !== 'boolean') return null;
  return { name, short, league, logo, own: Boolean(input.own) };
}

export function parsePlayerInput(input: unknown): PlayerInput | null {
  if (!isObject(input)) return null;
  const { teamId } = input;
  if (typeof teamId !== 'number' || !Number.isInteger(teamId) || teamId < 1) return null;
  const lastName = text(input.lastName, 1, 60);
  const firstName = text(input.firstName ?? '', 0, 60);
  const nationality = text(input.nationality ?? '', 0, 3);
  const externalId = text(input.externalId ?? '', 0, 30);
  if (lastName === null || firstName === null || nationality === null || externalId === null) return null;

  const rawNumber = input.number ?? null;
  if (
    rawNumber !== null &&
    !(typeof rawNumber === 'number' && Number.isInteger(rawNumber) && rawNumber >= 0 && rawNumber <= 999)
  ) {
    return null;
  }
  const bats = input.bats ?? '';
  const throws = input.throws ?? '';
  if (bats !== 'L' && bats !== 'R' && bats !== 'S' && bats !== '') return null;
  if (throws !== 'L' && throws !== 'R' && throws !== '') return null;

  return {
    teamId,
    lastName,
    firstName,
    number: rawNumber,
    nationality: nationality.toUpperCase(),
    bats,
    throws,
    externalId,
  };
}
