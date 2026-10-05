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

const STALE_MS = 40000;
let staleTimer = null;

function setLive(live) {
  body.dataset.live = live ? 'true' : 'false';
}

function applyProfile(p) {
  document.documentElement.removeAttribute('style');
  const root = document.documentElement.style;
  const c = p.colors ?? {};
  const map = {
    '--panel': c.panel,
    '--panel-text': c.panelText,
    '--accent': c.accent,
    '--muted': c.muted,
    '--score-bg': c.scoreBg,
    '--score-text': c.scoreText,
    '--base-on': c.baseOn,
    '--base-off': c.baseOff,
  };
  for (const [name, value] of Object.entries(map)) {
    if (typeof value === 'string') root.setProperty(name, value);
  }
  if (p.font && typeof p.font.family === 'string') root.setProperty('--font', p.font.family);
  if (p.font && typeof p.font.scale === 'number') root.setProperty('--scale', String(p.font.scale));
  if (typeof p.radius === 'number') root.setProperty('--radius', `${p.radius}px`);
  body.dataset.design = p.design === 'tafel' ? 'tafel' : 'modern';
  if (typeof c.frame === 'string') root.setProperty('--tafel-frame', c.frame);
  if (typeof c.glossTop === 'string') root.setProperty('--tafel-top', c.glossTop);
  if (typeof c.field === 'string') root.setProperty('--tafel-field', c.field);
  const layout = p.layout ?? {};
  if (typeof layout.margin === 'number') root.setProperty('--margin', `${layout.margin}px`);
  if (typeof layout.position === 'string') body.dataset.position = layout.position;
  const labels = p.labels ?? {};
  profile.labels = { top: '▲', bottom: '▼', out: 'OUT', pitch: 'P', ...labels };
  const show = p.show ?? {};
  $('pitches').hidden = show.pitchCount === false;
  $('bases').hidden = show.bases === false;
  $('count').hidden = show.count === false && show.outs === false;
  profile.show = show;
  $('out-label').textContent = profile.labels.out;
  $('pitch-label').textContent = profile.labels.pitch;
}

const profile = { labels: { top: '▲', bottom: '▼', out: 'OUT', pitch: 'P' }, show: {} };

function dots(id, filled, total) {
  const el = $(id);
  if (el.children.length !== total) {
    el.replaceChildren(...Array.from({ length: total }, () => Object.assign(document.createElement('span'), { className: 'dot' })));
  }
  [...el.children].forEach((dot, i) => dot.classList.toggle('on', i < filled));
}

function render(msg) {
  const g = msg.game;
  $('name-away').textContent = g.teams.away.short;
  $('name-home').textContent = g.teams.home.short;
  $('score-away').textContent = String(g.score.away);
  $('score-home').textContent = String(g.score.home);
  $('row-away').classList.toggle('batting', g.half === 'top');
  $('row-home').classList.toggle('batting', g.half === 'bottom');
  $('half').textContent = g.half === 'top' ? profile.labels.top : profile.labels.bottom;
  $('inning').textContent = String(g.inning);
  g.bases.forEach((on, i) => $(`base-${i + 1}`).classList.toggle('on', Boolean(on)));
  dots('balls', g.balls, g.rules.ballsForWalk - 1);
  dots('strikes', g.strikes, g.rules.strikesForStrikeout - 1);
  dots('outs', g.outs, g.rules.outsPerHalfInning - 1);
  const fielding = g.half === 'top' ? 'home' : 'away';
  $('pitch-count').textContent = String(g.pitches[fielding]);
  renderTafel(g);
  body.dataset.graphic = msg.graphics?.scoreboard ? 'on' : 'off';
  body.dataset.onair = msg.graphics?.scoreboard ? 'true' : 'false';
}

function renderTafel(g) {
  const fielding = g.half === 'top' ? 'home' : 'away';
  $('t-name-away').textContent = g.teams.away.short;
  $('t-name-home').textContent = g.teams.home.short;
  $('t-name-away').dataset.batting = String(g.half === 'top');
  $('t-name-home').dataset.batting = String(g.half === 'bottom');
  $('t-score-away').textContent = String(g.score.away);
  $('t-score-home').textContent = String(g.score.home);
  $('t-inning').textContent = `${g.half === 'top' ? 'TOP' : 'BOT'} ${g.inning}`;
  $('t-count').textContent = `${g.balls} - ${g.strikes}`;
  $('t-out').textContent = `${g.outs} ${profile.labels.out}`;
  $('t-pitch').textContent = `${profile.labels.pitch}:${g.pitches[fielding]}`;
  g.bases.forEach((on, i) => $(`t-base-${i + 1}`).classList.toggle('on', Boolean(on)));
}

function armStale() {
  clearTimeout(staleTimer);
  // Server pingt regelmäßig; kommt lange nichts, gilt die Anzeige als veraltet.
  staleTimer = setTimeout(() => setLive(false), STALE_MS);
}

let retry = 500;
function connect() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${scheme}://${location.host}/ws?role=${role}`);
  ws.addEventListener('open', () => {
    retry = 500;
  });
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
