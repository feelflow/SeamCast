'use strict';

const params = new URLSearchParams(location.search);
const role = params.get('role') === 'preview' ? 'preview' : 'overlay';
// Mit ?profile=… in der Adresse bleibt das Profil fest; sonst folgt das Overlay dem Layout dieser Grafik (Konfigurationsseite), ersatzweise dem Grundprofil.
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

const STALE_MS = 40000;
let staleTimer = null;
const setLive = (live) => (body.dataset.live = live ? 'true' : 'false');

function applyProfile(p) {
  document.documentElement.removeAttribute('style');
  const root = document.documentElement.style;
  const c = p.colors ?? {};
  const map = { '--panel': c.panel, '--panelText': c.panelText, '--panel-text': c.panelText, '--accent': c.accent, '--muted': c.muted };
  for (const [name, value] of Object.entries(map)) if (typeof value === 'string') root.setProperty(name, value);
  if (p.font && typeof p.font.family === 'string') root.setProperty('--font', p.font.family);
  if (p.font && typeof p.font.scale === 'number') root.setProperty('--scale', String(p.font.scale));
  if (typeof p.radius === 'number') root.setProperty('--radius', `${p.radius}px`);
}

function renderSide(side, msg) {
  const rows = msg.lineups?.[side] ?? [];
  const section = $(`lineup-${side}`);
  section.hidden = rows.length === 0;
  $(`title-${side}`).textContent = msg.game.teams[side].name;
  const items = rows.map((r) => {
    const li = document.createElement('li');
    const cells = [['o', String(r.order)], ['n', r.number === null ? '' : String(r.number)], ['l', r.lastName], ['p', r.pos]];
    for (const [cls, text] of cells) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      li.append(span);
    }
    return li;
  });
  $(`list-${side}`).replaceChildren(...items);
  const id = side === 'away' ? 'lineupAway' : 'lineupHome';
  section.dataset.show = msg.graphics?.[id] ? 'true' : 'false';
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
    ensureProfile(fixedProfile ?? msg.layouts?.lineup ?? msg.profile ?? 'default').then(() => {
      renderSide('away', latest);
      renderSide('home', latest);
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
