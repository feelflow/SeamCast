'use strict';

const params = new URLSearchParams(location.search);
const role = params.get('role') === 'preview' ? 'preview' : 'overlay';
const profileId = /^[a-z0-9-]{1,40}$/.test(params.get('profile') ?? '') ? params.get('profile') : 'default';
const body = document.body;
const $ = (id) => document.getElementById(id);
body.dataset.role = role;

const STALE_MS = 40000;
let staleTimer = null;
let config = { batter: { label: 'AM SCHLAG', stats: [] }, pitcher: { label: 'PITCHER', stats: [], pitchCount: false } };
let labels = { pitch: 'P' };
const setLive = (live) => (body.dataset.live = live ? 'true' : 'false');

function applyProfile(p) {
  const root = document.documentElement.style;
  const c = p.colors ?? {};
  const map = { '--panel': c.panel, '--panel-text': c.panelText, '--accent': c.accent, '--muted': c.muted };
  for (const [name, value] of Object.entries(map)) if (typeof value === 'string') root.setProperty(name, value);
  if (p.font && typeof p.font.family === 'string') root.setProperty('--font', p.font.family);
  if (p.font && typeof p.font.scale === 'number') root.setProperty('--scale', String(p.font.scale));
  if (typeof p.radius === 'number') root.setProperty('--radius', `${p.radius}px`);
  const cards = p.cards ?? {};
  if (typeof cards.margin === 'number') root.setProperty('--margin', `${cards.margin}px`);
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
    render(msg);
    setLive(true);
    armStale();
  });
  ws.addEventListener('close', () => {
    setLive(false);
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 5000);
  });
  ws.addEventListener('error', () => ws.close());
}

fetch(`/api/profiles/${profileId}`)
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}))
  .then((p) => {
    applyProfile(p);
    connect();
  });
