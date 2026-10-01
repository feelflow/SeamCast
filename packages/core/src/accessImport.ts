import { parseInnings } from './stats.js';
import { parsePlayerInput, parseTeamInput, type Bats, type Throws } from './roster.js';

/**
 * Überführt die Tabellen der alten Access-Datei (HTV-Manager) in Datensätze für SeamCast.
 * Reine Funktion auf Zeilen: das Lesen der Datei selbst passiert im Server.
 *
 * Bekannte Eigenheiten der Vorlage, die hier abgefangen werden:
 * - Spalten heißen teils mit Leerzeichen („Off_ RoundID“)
 * - Spieler verweisen nur über den Mannschaftsnamen auf ihr Team, in anderer Schreibweise („STORM“ / „Storm“)
 * - Ligen stehen in Klammern, Nummern teils als Text mit Komma
 * - Innings Pitched stehen als „4,2“ (Drittel!)
 * - Gespeicherte Quoten (BA, OBP, ERA …) und die Spalten F36–F41 werden verworfen; Quoten rechnet SeamCast selbst
 */
export type RawRow = Record<string, unknown>;

export interface AccessTables {
  teams: RawRow[];
  players: RawRow[];
  offense: RawRow[];
  pitching: RawRow[];
}

export interface PlannedTeam {
  name: string;
  short: string;
  league: string;
  logo: string;
}

export interface PlannedPlayer {
  teamName: string;
  externalId: string;
  lastName: string;
  firstName: string;
  nationality: string;
  number: number | null;
  bats: Bats;
  throws: Throws;
}

export interface StatKey {
  externalId: string;
  season: number;
  roundId: number;
  roundName: string;
  league: string;
}

export interface PlannedBatting extends StatKey {
  g: number; pa: number; ab: number; r: number; h: number; rbi: number;
  doubles: number; triples: number; hr: number; sb: number; cs: number; pick: number;
  bb: number; so: number; hbp: number; sh: number; sf: number; ibb: number; gidp: number; lob: number;
}

export interface PlannedPitching extends StatKey {
  g: number; gs: number; cg: number; h: number; r: number; er: number; bb: number; so: number;
  hbp: number; wp: number; bk: number; w: number; l: number; sv: number; bs: number;
  svOpp: number; hold: number; bf: number; gb: number; fb: number;
  a1b: number; a2b: number; a3b: number; hr: number; sh: number; ipThirds: number;
}

export interface ImportPlan {
  teams: PlannedTeam[];
  players: PlannedPlayer[];
  batting: PlannedBatting[];
  pitching: PlannedPitching[];
  warnings: string[];
}

/** Entfernt Leerraum aus den Spaltennamen. */
function normalize(row: RawRow): RawRow {
  const result: RawRow = {};
  for (const [key, value] of Object.entries(row)) result[key.replace(/\s+/g, '')] = value;
  return result;
}

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value).trim());

/** Ganze Zahl aus Zahl oder Text („12“, „12,0“); sonst null. */
function whole(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

const key = (text: string): string => text.trim().toLocaleLowerCase('de');

function stripBrackets(league: string): string {
  return league.replace(/^\((.*)\)$/, '$1').trim();
}

export function planAccessImport(tables: AccessTables): ImportPlan {
  const warnings: string[] = [];
  const plan: ImportPlan = { teams: [], players: [], batting: [], pitching: [], warnings };

  // Mannschaften
  const teamByName = new Map<string, PlannedTeam>();
  for (const raw of tables.teams.map(normalize)) {
    const base = { name: str(raw.Team), short: str(raw.Short), league: stripBrackets(str(raw.League)) };
    let team = parseTeamInput({ ...base, logo: str(raw.LogoURL) });
    if (!team) {
      team = parseTeamInput(base);
      if (!team) {
        warnings.push(`Mannschaft „${base.name}“ übersprungen: Name oder Kürzel ungültig.`);
        continue;
      }
      warnings.push(`Logo von „${team.name}“ ignoriert: „${str(raw.LogoURL)}“ ist kein einfacher Dateiname.`);
    }
    if (teamByName.has(key(team.name))) {
      warnings.push(`Mannschaft „${team.name}“ steht mehrfach in der Datei, nur der erste Eintrag zählt.`);
      continue;
    }
    const planned: PlannedTeam = { name: team.name, short: team.short, league: team.league, logo: team.logo };
    teamByName.set(key(team.name), planned);
    plan.teams.push(planned);
  }

  // Spieler
  const playerIds = new Set<string>();
  for (const raw of tables.players.map(normalize)) {
    const label = `${str(raw.Lastname)}, ${str(raw.Name)}`;
    const id = whole(raw.ID);
    if (id === null || id <= 0) {
      warnings.push(`Spieler „${label}“ übersprungen: keine gültige Spieler-ID.`);
      continue;
    }
    const externalId = String(id);
    if (playerIds.has(externalId)) {
      warnings.push(`Spieler-ID ${externalId} („${label}“) kommt doppelt vor, der erste Eintrag zählt.`);
      continue;
    }
    const team = teamByName.get(key(str(raw.TeamShort)));
    if (!team) {
      warnings.push(`Spieler „${label}“ übersprungen: Mannschaft „${str(raw.TeamShort)}“ ist unbekannt.`);
      continue;
    }
    let bats = str(raw.Bats).toUpperCase();
    if (!['L', 'R', 'S', ''].includes(bats)) {
      warnings.push(`Spieler „${label}“: Schlaghand „${bats}“ ungültig, leer gelassen.`);
      bats = '';
    }
    let throws = str(raw.Throws).toUpperCase();
    if (!['L', 'R', ''].includes(throws)) {
      warnings.push(`Spieler „${label}“: Wurfhand „${throws}“ ungültig, leer gelassen.`);
      throws = '';
    }
    const number = whole(raw.UniformNr);
    const parsed = parsePlayerInput({
      teamId: 1,
      lastName: str(raw.Lastname),
      firstName: str(raw.Name),
      nationality: str(raw.Nationality),
      number: number !== null && number >= 0 && number <= 999 ? number : null,
      bats,
      throws,
      externalId,
    });
    if (!parsed) {
      warnings.push(`Spieler „${label}“ übersprungen: Angaben ungültig.`);
      continue;
    }
    playerIds.add(externalId);
    plan.players.push({
      teamName: team.name,
      externalId,
      lastName: parsed.lastName,
      firstName: parsed.firstName,
      nationality: parsed.nationality,
      number: parsed.number,
      bats: parsed.bats,
      throws: parsed.throws,
    });
  }

  const count = (raw: RawRow, column: string): number => {
    const n = whole(raw[column]);
    return n !== null && n >= 0 ? n : 0;
  };

  const statKey = (raw: RawRow, prefix: 'Off' | 'Pit'): StatKey | null => {
    const id = whole(raw[`${prefix}_PlayerID`]);
    const season = whole(raw[`${prefix}_Year`]);
    const roundId = whole(raw[`${prefix}_RoundID`]);
    const who = str(raw[`${prefix}_Player`]);
    if (id === null || !playerIds.has(String(id))) {
      warnings.push(`Statistik für „${who}“ übersprungen: Spieler ist nicht im Kader.`);
      return null;
    }
    if (season === null || roundId === null) {
      warnings.push(`Statistik für „${who}“ übersprungen: Jahr oder Runde fehlt.`);
      return null;
    }
    return { externalId: String(id), season, roundId, roundName: str(raw[`${prefix}_RoundName`]), league: str(raw[`${prefix}_League`]) };
  };

  for (const raw of tables.offense.map(normalize)) {
    const k = statKey(raw, 'Off');
    if (!k) continue;
    const c = (column: string) => count(raw, `Off_${column}`);
    plan.batting.push({
      ...k,
      g: c('G'), pa: c('PA'), ab: c('AB'), r: c('R'), h: c('H'), rbi: c('RBI'),
      doubles: c('2B'), triples: c('3B'), hr: c('HR'), sb: c('SB'), cs: c('CS'), pick: c('Pick'),
      bb: c('BB'), so: c('SO'), hbp: c('HBP'), sh: c('S'), sf: c('SF'), ibb: c('IBB'), gidp: c('GIDP'), lob: c('LOB'),
    });
  }

  for (const raw of tables.pitching.map(normalize)) {
    const k = statKey(raw, 'Pit');
    if (!k) continue;
    const ip = parseInnings(str(raw.Pit_IP) === '' ? 0 : str(raw.Pit_IP));
    if (ip === null) {
      warnings.push(`Pitching-Statistik für „${str(raw.Pit_Player)}“ übersprungen: Innings „${str(raw.Pit_IP)}“ ungültig.`);
      continue;
    }
    const c = (column: string) => count(raw, `Pit_${column}`);
    plan.pitching.push({
      ...k,
      g: c('G'), gs: c('GS'), cg: c('CG'), h: c('H'), r: c('R'), er: c('ER'), bb: c('BB'), so: c('SO'),
      hbp: c('HBP'), wp: c('WP'), bk: c('BK'), w: c('W'), l: c('L'), sv: c('SV'), bs: c('BS'),
      svOpp: c('SVOpp'), hold: c('Hold'), bf: c('BF'), gb: c('Groundballs'), fb: c('Flyballs'),
      a1b: c('1BA'), a2b: c('2BA'), a3b: c('3BA'), hr: c('HR'), sh: c('SH'), ipThirds: ip,
    });
  }

  return plan;
}
