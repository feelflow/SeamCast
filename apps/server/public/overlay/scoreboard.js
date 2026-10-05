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

function setLive(live) {
  body.dataset.live = live ? 'true' : 'false';
}

/** Abschnitt „scoreboard“ des Profils überschreibt nur das Scoreboard (Karten und Aufstellung bleiben unberührt). */
function withScoreboardOverrides(p) {
  const o = p.scoreboard;
  if (!o || typeof o !== 'object') return p;
  const merged = { ...p, ...o };
  for (const key of ['colors', 'font', 'labels', 'show', 'layout', 'bild']) {
    if (o[key] && typeof o[key] === 'object') merged[key] = { ...(p[key] ?? {}), ...o[key] };
  }
  return merged;
}

function applyProfile(profileData) {
  const p = withScoreboardOverrides(profileData);
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
  body.dataset.design = p.design === 'tafel' || p.design === 'bild' ? p.design : 'modern';
  if (typeof c.field === 'string') root.setProperty('--bild-field', c.field);
  profile.bild = p.design === 'bild' ? p.bild ?? null : null;
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
  setupBild();
}

const profile = { labels: { top: '▲', bottom: '▼', out: 'OUT', pitch: 'P' }, show: {}, bild: null };

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
  renderBild(g);
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

const BILD_FIELDS = ['away', 'awayScore', 'home', 'homeScore', 'inning', 'pitch', 'count', 'out'];
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Design „bild“: Hintergrundbild und Textfelder an den Maßen aus dem Profil (Abschnitt „bild“) platzieren. */
function setupBild() {
  const b = profile.bild;
  if (!b) return;
  const back = $('b-back');
  const image = typeof b.image === 'string' && /^[\w.-]{1,100}$/.test(b.image) ? b.image : null;
  if (image) back.src = `/assets/${image}`;
  back.hidden = !image;
  back.style.left = `${num(b.x, 0)}px`;
  back.style.top = `${num(b.y, 0)}px`;
  back.style.width = `${num(b.width, 596)}px`;
  back.style.height = `${num(b.height, 115)}px`;
  const bases = $('b-bases');
  const bb = b.bases ?? {};
  bases.style.left = `${num(bb.x, 0)}px`;
  bases.style.top = `${num(bb.y, 0)}px`;
  bases.style.width = `${num(bb.width, 143)}px`;
  bases.style.height = `${num(bb.height, 110)}px`;
  bases.hidden = profile.show.bases === false;
  const fonts = b.font ?? {};
  for (const key of BILD_FIELDS) {
    const f = (b.fields ?? {})[key] ?? {};
    const el = $(`b-${key}`);
    el.style.left = `${num(f.x, 0)}px`;
    el.style.top = `${num(f.y, 0)}px`;
    el.style.width = `${num(f.width, 100)}px`;
    el.style.height = `${num(f.height, 40)}px`;
    el.style.fontSize = `${num(f.size, 32)}px`;
    el.style.color = typeof f.color === 'string' ? f.color : '#ffffff';
    el.dataset.align = ['left', 'center', 'right'].includes(f.align) ? f.align : 'left';
    if (typeof fonts.family === 'string') el.style.fontFamily = fonts.family;
  }
  $('b-pitch').hidden = profile.show.pitchCount === false;
  $('b-count').hidden = profile.show.count === false;
  $('b-out').hidden = profile.show.outs === false;
}

/** Text ins Feld setzen; ist er breiter als das Feld, wird er schmaler gestaucht (statt abgeschnitten). */
function setBildText(key, text) {
  const el = $(`b-${key}`);
  const span = el.firstElementChild;
  span.textContent = text;
  span.style.transform = '';
  const avail = el.clientWidth;
  const need = span.scrollWidth;
  if (avail > 0 && need > avail) span.style.transform = `scaleX(${avail / need})`;
}

function renderBild(g) {
  if (!profile.bild) return;
  const fielding = g.half === 'top' ? 'home' : 'away';
  setBildText('away', g.teams.away.short);
  setBildText('home', g.teams.home.short);
  $('b-away').dataset.batting = String(g.half === 'top' && profile.bild.highlightBatting === true);
  $('b-home').dataset.batting = String(g.half === 'bottom' && profile.bild.highlightBatting === true);
  setBildText('awayScore', String(g.score.away));
  setBildText('homeScore', String(g.score.home));
  setBildText('inning', `${g.half === 'top' ? profile.labels.top : profile.labels.bottom} ${g.inning}`);
  setBildText('pitch', `${profile.labels.pitch}: ${g.pitches[fielding]}`);
  setBildText('count', `${g.balls} - ${g.strikes}`);
  setBildText('out', `${g.outs} ${profile.labels.out}`);
  g.bases.forEach((on, i) => $(`b-base-${i + 1}`).classList.toggle('on', Boolean(on)));
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
    ensureProfile(fixedProfile ?? msg.layouts?.scoreboard ?? msg.profile ?? 'default').then(() => {
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
