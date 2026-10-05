'use strict';

const params = new URLSearchParams(location.search);
const role = params.get('role') === 'preview' ? 'preview' : 'overlay';
// Mit ?profile=… in der Adresse bleibt das Profil fest; sonst folgt das Overlay dem Layout dieser Grafik (Konfigurationsseite), ersatzweise dem Grundprofil.
const fixedProfile = /^[a-z0-9-]{1,40}$/.test(params.get('profile') ?? '') ? params.get('profile') : null;
const KINDS = ['batter', 'pitcher'];
// ?only=batter bzw. ?only=pitcher zeigt nur diese Karte (z. B. für die Vorschau auf der Einstellungsseite).
const only = KINDS.includes(params.get('only')) ? params.get('only') : null;
// Batter und Pitcher können je ein eigenes Layout haben; geladen wird je Karte.
const loadedProfile = { batter: null, pitcher: null };
let latest = null;

async function ensureProfile(kind, id) {
  if (id === loadedProfile[kind]) return;
  loadedProfile[kind] = id;
  let p = {};
  try {
    const r = await fetch(`/api/profiles/${id}`);
    if (r.ok) p = await r.json();
  } catch {
    // Standardwerte genügen
  }
  // Während des Ladens kann schon ein anderes Layout gewählt worden sein
  if (loadedProfile[kind] === id) applyProfile(kind, p);
}
const body = document.body;
const $ = (id) => document.getElementById(id);
body.dataset.role = role;

const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
const TAG_KEYS = ['pos', 'bats', 'throws', 'teamShort'];
const CARD_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const STALE_MS = 40000;
let staleTimer = null;
const defaults = () => ({
  batter: { label: 'AM SCHLAG', stats: [] },
  pitcher: { label: 'PITCHER', stats: [], pitchCount: false },
});
let config = defaults();
const labels = { batter: { pitch: 'P' }, pitcher: { pitch: 'P' } };
const groupSource = { batter: {}, pitcher: {} };
const setLive = (live) => (body.dataset.live = live ? 'true' : 'false');

/** Farben, Schrift und Maße gelten nur für die jeweilige Karte (Eigenschaften der Karte statt des ganzen Overlays). */
function applyProfile(kind, p) {
  const section = $(`card-${kind}`);
  section.removeAttribute('style');
  const root = section.style;
  const c = p.colors ?? {};
  const map = {
    '--panel': c.panel,
    '--panel-text': c.panelText,
    '--accent': c.accent,
    '--muted': c.muted,
    '--card-head': c.cardHead,
    '--card-head-end': c.cardHeadEnd,
    '--card-body': c.cardBody,
    '--card-label': c.cardLabel,
    '--card-line': c.cardLine,
  };
  for (const [name, value] of Object.entries(map)) if (typeof value === 'string') root.setProperty(name, value);
  if (p.font && typeof p.font.family === 'string') root.setProperty('--font', p.font.family);
  if (p.font && typeof p.font.scale === 'number') root.setProperty('--scale', String(p.font.scale));
  if (typeof p.radius === 'number') root.setProperty('--radius', `${p.radius}px`);
  const cards = p.cards ?? {};
  if (typeof cards.margin === 'number') root.setProperty('--margin', `${cards.margin}px`);
  if (typeof cards.marginX === 'number') root.setProperty('--margin-x', `${cards.marginX}px`);
  if (typeof cards.marginY === 'number') root.setProperty('--margin-y', `${cards.marginY}px`);
  config[kind] = { ...defaults()[kind], ...(cards[kind] ?? {}) };
  labels[kind] = { pitch: 'P', ...(p.labels ?? {}) };
  groupSource[kind] = { position: typeof cards.position === 'string' ? cards.position : '', margin: cards.margin, marginX: cards.marginX, marginY: cards.marginY };
  applyGroup();
}

/** Position der Kartengruppe (Karten ohne eigene Position): nach der Karte, die gerade zu sehen ist, sonst nach dem Batter. */
function applyGroup() {
  const kind = latest?.graphics?.pitcher && !latest?.graphics?.batter ? 'pitcher' : 'batter';
  const g = groupSource[kind];
  const group = $('cards').style;
  for (const [name, value] of [['--margin', g.margin], ['--margin-x', g.marginX], ['--margin-y', g.marginY]]) {
    if (typeof value === 'number') group.setProperty(name, `${value}px`);
    else group.removeProperty(name);
  }
  if (g.position) body.dataset.position = g.position;
}

function statCell(label, value, extraClass) {
  const cell = document.createElement('div');
  cell.className = `stat${extraClass ? ` ${extraClass}` : ''}`;
  const small = document.createElement('small');
  small.textContent = label;
  const strong = document.createElement('b');
  strong.textContent = value;
  cell.append(small, strong);
  return cell;
}

function renderCard(kind, card, visible, extras) {
  const section = $(`card-${kind}`);
  section.hidden = !card || (only !== null && only !== kind);
  if (section.hidden) return;
  section.dataset.layout = ['table', 'wide'].includes(config[kind].layout) ? config[kind].layout : 'row';
  // Eigene Position je Karte (Profil: cards.<batter|pitcher>.position); ohne Angabe reiht sich die Karte in die Gruppe ein
  const pos = CARD_POSITIONS.includes(config[kind].position) ? config[kind].position : '';
  if (pos) section.dataset.pos = pos;
  else delete section.dataset.pos;
  const logo = $(`${kind}-logo`);
  // Logo = reiner Dateiname aus config/assets (Profil: cards.<batter|pitcher>.logo)
  const logoFile = FILE_NAME.test(config[kind].logo ?? '') ? config[kind].logo : '';
  if (logoFile) {
    const src = `/assets/${logoFile}`;
    if (logo.getAttribute('src') !== src) logo.setAttribute('src', src);
  } else {
    logo.removeAttribute('src');
  }
  logo.hidden = !logoFile;
  // Vereinslogo aus dem Kader (Datei in config/assets), nur wenn das Profil es verlangt
  const club = $(`${kind}-club`);
  const clubFile = config[kind].teamLogo && FILE_NAME.test(card.teamLogo ?? '') ? card.teamLogo : '';
  if (clubFile) {
    const src = `/assets/${clubFile}`;
    if (club.getAttribute('src') !== src) club.setAttribute('src', src);
  } else {
    club.removeAttribute('src');
  }
  club.hidden = !clubFile;
  // Zusatzzeile unter der Nummer (Profil: tag = pos | bats | throws | teamShort; pos = Position aus der Aufstellung)
  const tag = $(`${kind}-tag`);
  tag.textContent = TAG_KEYS.includes(config[kind].tag) ? String(card[config[kind].tag] ?? '') : '';
  tag.hidden = !tag.textContent;
  $(`${kind}-num`).textContent = card.number === null ? '' : String(card.number);
  $(`${kind}-num`).hidden = card.number === null;
  $(`${kind}-role`).textContent = config[kind].label ?? '';
  $(`${kind}-first`).textContent = card.firstName;
  $(`${kind}-last`).textContent = card.lastName;
  const sub = [card.teamShort, kind === 'batter' && card.bats ? `Bats ${card.bats}` : '', kind === 'pitcher' && card.throws ? `Throws ${card.throws}` : '']
    .filter(Boolean)
    .join(' · ');
  $(`${kind}-sub`).textContent = sub;
  const cells = (config[kind].stats ?? []).map(([key, label]) => statCell(String(label), card.stats[key] ?? '–'));
  if (extras) cells.push(extras);
  $(`${kind}-stats`).replaceChildren(...cells);
  fitName(section);
  section.dataset.show = visible ? 'true' : 'false';
}

/** Lange Namen verkleinern, bis sie in die Karte passen (nicht unter 60 % der Schriftgröße). */
function fitName(section) {
  const name = section.querySelector('.name');
  name.style.fontSize = '';
  const wide = section.dataset.layout === 'wide';
  if (!wide && section.dataset.layout !== 'table') return;
  const limit = wide ? () => name.clientWidth : () => name.parentElement.clientWidth;
  const width = wide ? () => name.scrollWidth : () => name.offsetWidth;
  const base = parseFloat(getComputedStyle(name).fontSize);
  for (let size = base - 1; size >= base * 0.6 && width() > limit(); size -= 1) name.style.fontSize = `${size}px`;
}

function render(msg) {
  const g = msg.game;
  const fielding = g.half === 'top' ? 'home' : 'away';
  const pitchCell = config.pitcher.pitchCount ? statCell(labels.pitcher.pitch, String(g.pitches[fielding]), 'pc') : null;
  renderCard('batter', msg.cards?.batter ?? null, Boolean(msg.graphics?.batter), null);
  renderCard('pitcher', msg.cards?.pitcher ?? null, Boolean(msg.graphics?.pitcher), pitchCell);
}

function armStale() {
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => setLive(false), STALE_MS);
}

let retry = 500;
function connect() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${scheme}://${location.host}/ws?role=${role}`);
  ws.addEventListener('open', () => (retry = 500));
  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type !== 'snapshot') return;
    latest = msg;
    const pick = (kind) => fixedProfile ?? msg.layouts?.[kind] ?? msg.profile ?? 'default';
    Promise.all(KINDS.map((kind) => ensureProfile(kind, pick(kind)))).then(() => {
      applyGroup();
      render(latest);
      setLive(true);
      armStale();
    });
  });
  ws.addEventListener('close', () => {
    setLive(false);
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 5000);
  });
  ws.addEventListener('error', () => ws.close());
}

connect();
