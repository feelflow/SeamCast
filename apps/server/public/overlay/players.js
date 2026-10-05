'use strict';

const params = new URLSearchParams(location.search);
const role = params.get('role') === 'preview' ? 'preview' : 'overlay';
// Mit ?profile=… in der Adresse bleibt das Profil fest; sonst folgt das Overlay der Wahl in der Bedienung.
const fixedProfile = /^[a-z0-9-]{1,40}$/.test(params.get('profile') ?? '') ? params.get('profile') : null;
let loadedProfile = null;
let latest = null;

async function ensureProfile(id) {
  if (id === loadedProfile) return;
  loadedProfile = id;
  let p = {};
  try {
    const r = await fetch(`/api/profiles/${id}`);
    if (r.ok) p = await r.json();
  } catch {
    // Standardwerte genügen
  }
  applyProfile(p);
}
const body = document.body;
const $ = (id) => document.getElementById(id);
body.dataset.role = role;

const CARD_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const STALE_MS = 40000;
let staleTimer = null;
let config = { batter: { label: 'AM SCHLAG', stats: [] }, pitcher: { label: 'PITCHER', stats: [], pitchCount: false } };
let labels = { pitch: 'P' };
const setLive = (live) => (body.dataset.live = live ? 'true' : 'false');

function applyProfile(p) {
  document.documentElement.removeAttribute('style');
  const root = document.documentElement.style;
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
  config = { batter: { label: 'AM SCHLAG', stats: [] }, pitcher: { label: 'PITCHER', stats: [], pitchCount: false } };
  const cards = p.cards ?? {};
  if (typeof cards.margin === 'number') root.setProperty('--margin', `${cards.margin}px`);
  if (typeof cards.marginX === 'number') root.setProperty('--margin-x', `${cards.marginX}px`);
  if (typeof cards.marginY === 'number') root.setProperty('--margin-y', `${cards.marginY}px`);
  if (typeof cards.position === 'string') body.dataset.position = cards.position;
  for (const kind of ['batter', 'pitcher']) if (cards[kind]) config[kind] = { ...config[kind], ...cards[kind] };
  labels = { pitch: 'P', ...(p.labels ?? {}) };
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
  section.hidden = !card;
  if (!card) return;
  section.dataset.layout = config[kind].layout === 'table' ? 'table' : 'row';
  // Eigene Position je Karte (Profil: cards.<batter|pitcher>.position); ohne Angabe reiht sich die Karte in die Gruppe ein
  const pos = CARD_POSITIONS.includes(config[kind].position) ? config[kind].position : '';
  if (pos) section.dataset.pos = pos;
  else delete section.dataset.pos;
  const logo = $(`${kind}-logo`);
  // Logo = reiner Dateiname aus config/assets (Profil: cards.<batter|pitcher>.logo)
  const logoFile = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(config[kind].logo ?? '') ? config[kind].logo : '';
  if (logoFile) {
    const src = `/assets/${logoFile}`;
    if (logo.getAttribute('src') !== src) logo.setAttribute('src', src);
  } else {
    logo.removeAttribute('src');
  }
  logo.hidden = !logoFile;
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
  section.dataset.show = visible ? 'true' : 'false';
}

function render(msg) {
  const g = msg.game;
  const fielding = g.half === 'top' ? 'home' : 'away';
  const pitchCell = config.pitcher.pitchCount ? statCell(labels.pitch, String(g.pitches[fielding]), 'pc') : null;
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
    ensureProfile(fixedProfile ?? msg.profile ?? 'default').then(() => {
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
