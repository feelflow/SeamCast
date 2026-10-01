'use strict';

const params = new URLSearchParams(location.search);
const role = params.get('role') === 'preview' ? 'preview' : 'overlay';
const profileId = /^[a-z0-9-]{1,40}$/.test(params.get('profile') ?? '') ? params.get('profile') : 'default';
const body = document.body;
const $ = (id) => document.getElementById(id);
body.dataset.role = role;

const STALE_MS = 40000;
let staleTimer = null;
const setLive = (live) => (body.dataset.live = live ? 'true' : 'false');

function applyProfile(p) {
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
    renderSide('away', msg);
    renderSide('home', msg);
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
