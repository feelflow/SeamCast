'use strict';

// Einblendungen für Homerun, Grand Slam und Strikeout (Ersatz für die früheren Videos).
// Der Server meldet ein Ereignis als Snapshot-Feld `event: {id, kind}`; jede neue Nummer startet die Animation.
// Maße, Farben, Schrift und Texte stehen im Profil (Abschnitt "events"), siehe docs/protocol.md.

const params = new URLSearchParams(location.search);
const role = params.get('role') === 'preview' ? 'preview' : 'overlay';
const fixedProfile = /^[a-z0-9-]{1,40}$/.test(params.get('profile') ?? '') ? params.get('profile') : null;
// ?test=homerun | grandslam | strikeout spielt die Einblendung einmal beim Laden ab (zum Prüfen in OBS/vMix).
const testKind = params.get('test');

const $ = (id) => document.getElementById(id);
const body = document.body;
body.dataset.role = role;
const bar = $('bar');
const hot = bar.querySelector('.hot');
const dots = [...bar.querySelectorAll('.dots i')];
const label = $('label');
const labelText = document.createElement('span');
label.append(labelText);

const KINDS = ['homerun', 'grandslam', 'strikeout'];
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([0-9\s.,%]+\)|[a-z]{3,20})$/i;
const STALE_MS = 40000;

const defaults = () => ({
  x: 64,
  y: 40,
  width: 600,
  height: 112,
  speed: 1,
  font: { family: "'Trebuchet MS', 'Segoe UI', Arial, sans-serif" },
  colors: { base: '#343434', baseEnd: '#0b0b0b', hot: '#950101', text: '#ffffff', dot: '#d8d8d8' },
  homerun: { enabled: true, text: 'HOME RUN', size: 80 },
  grandslam: { enabled: true, text: 'GRAND SLAM', text2: 'HOME RUN', size: 80 },
  strikeout: { enabled: true, text: 'STRIKE OUT', size: 68 },
});
let config = defaults();
let loadedProfile = null;
let latest = null;
let lastEventId;
let staleTimer = null;
const setLive = (live) => (body.dataset.live = live ? 'true' : 'false');

const num = (value, min, max, fallback) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
const color = (value, fallback) => (typeof value === 'string' && COLOR.test(value) ? value : fallback);
const text = (value, fallback) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 30) : fallback);

/** Profilabschnitt "events" prüfen und über die Standardwerte legen. */
function readConfig(profile) {
  const d = defaults();
  const e = profile && typeof profile.events === 'object' && profile.events ? profile.events : {};
  const c = typeof e.colors === 'object' && e.colors ? e.colors : {};
  const cfg = {
    x: num(e.x, 0, 1900, d.x),
    y: num(e.y, 0, 1000, d.y),
    width: num(e.width, 100, 1900, d.width),
    height: num(e.height, 30, 400, d.height),
    speed: num(e.speed, 0.25, 4, 1),
    font: { family: typeof e.font?.family === 'string' && !/[;{}]/.test(e.font.family) ? e.font.family.slice(0, 200) : d.font.family },
    colors: {
      base: color(c.base, d.colors.base),
      baseEnd: color(c.baseEnd, d.colors.baseEnd),
      hot: color(c.hot, d.colors.hot),
      text: color(c.text, d.colors.text),
      dot: color(c.dot, d.colors.dot),
    },
  };
  for (const kind of KINDS) {
    const k = typeof e[kind] === 'object' && e[kind] ? e[kind] : {};
    cfg[kind] = {
      enabled: k.enabled !== false,
      text: text(k.text, d[kind].text),
      text2: text(k.text2, d[kind].text2 ?? ''),
      size: num(k.size, 10, 400, d[kind].size),
    };
  }
  return cfg;
}

function applyConfig(cfg) {
  config = cfg;
  const root = document.documentElement.style;
  root.setProperty('--ev-x', `${cfg.x}px`);
  root.setProperty('--ev-y', `${cfg.y}px`);
  root.setProperty('--ev-w', `${cfg.width}px`);
  root.setProperty('--ev-h', `${cfg.height}px`);
  root.setProperty('--ev-font', cfg.font.family);
  root.setProperty('--ev-base', cfg.colors.base);
  root.setProperty('--ev-base-end', cfg.colors.baseEnd);
  root.setProperty('--ev-hot', cfg.colors.hot);
  root.setProperty('--ev-text', cfg.colors.text);
  root.setProperty('--ev-dot', cfg.colors.dot);
}

async function ensureProfile(id) {
  if (id === loadedProfile) return;
  loadedProfile = id;
  let profile = {};
  try {
    const r = await fetch(`/api/profiles/${id}`);
    if (r.ok) profile = await r.json();
  } catch {
    // Standardwerte genügen
  }
  if (loadedProfile === id) applyConfig(readConfig(profile));
}

// ---------- Ablauf ----------

let run = 0; // Nummer des laufenden Ablaufs; ein neuer Start bricht den alten ab
let running = [];

const ease = { out: 'cubic-bezier(0.16, 0.8, 0.3, 1)', inOut: 'cubic-bezier(0.65, 0, 0.35, 1)' };

/** Spielt eine Animation ab und wartet auf ihr Ende (oder ihren Abbruch). */
function play(el, keyframes, ms, easing = ease.inOut, extra = {}) {
  const animation = el.animate(keyframes, { duration: Math.max(1, ms / config.speed), easing, fill: 'forwards', ...extra });
  running.push(animation);
  return animation.finished.catch(() => {});
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms / config.speed));

function reset() {
  for (const a of running) a.cancel();
  running = [];
  bar.hidden = true;
  label.hidden = true;
  labelText.textContent = '';
  labelText.style.fontSize = '';
}

const wipeIn = (ms) => play(bar, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], ms);
const exit = (ms) =>
  Promise.all([
    play(bar, [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }], ms),
    play(label, [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }], ms, ease.inOut, { composite: 'replace' }),
  ]);

/** Roter Punkt wächst in der Mitte und färbt den Balken. */
const hotOpen = (ms) =>
  play(
    hot,
    [
      { clipPath: 'ellipse(0% 0% at 50% 50%)' },
      { clipPath: 'ellipse(9.3% 50% at 50% 50%)', offset: 0.35 },
      { clipPath: 'ellipse(72% 115% at 50% 50%)' },
    ],
    ms,
  );
const hotClose = (ms) =>
  play(
    hot,
    [
      { clipPath: 'ellipse(72% 115% at 50% 50%)' },
      { clipPath: 'ellipse(9.3% 50% at 50% 50%)', offset: 0.65 },
      { clipPath: 'ellipse(0% 0% at 50% 50%)' },
    ],
    ms,
  );

/** Beschriftung kleiner machen, bis sie in den Balken passt. */
function setLabel(value, size) {
  labelText.style.fontSize = '';
  labelText.textContent = value;
  label.style.fontSize = `${size}px`;
  label.hidden = false;
  const limit = config.width * 0.94;
  const width = labelText.offsetWidth;
  if (width > limit) labelText.style.fontSize = `${(size * limit) / width}px`;
}

/** Große weiße Schrift wischt von links durchs Bild und schrumpft in den Balken. */
function sweep(value, size, ms) {
  setLabel(value, size);
  return play(
    label,
    [
      { transform: 'scale(3.95)', opacity: 0 },
      { opacity: 1, offset: 0.25 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    ms,
    ease.out,
  );
}

function fadeText(value, size, ms) {
  setLabel(value, size);
  return play(label, [{ transform: 'scale(1.12)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], ms, ease.out);
}

const dotsIn = () =>
  Promise.all(
    dots.map((dot, i) =>
      play(dot, [{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], 160, ease.out, { delay: (i * 70) / config.speed }),
    ),
  );
const dotsOut = () =>
  Promise.all(dots.map((dot) => play(dot, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.7)', opacity: 0 }], 260, ease.inOut)));

/** Jeder Ablauf ist eine Liste von Schritten; zwischen den Schritten wird geprüft, ob ein neuer Ablauf gestartet wurde. */
const SEQUENCES = {
  homerun: (k) => [
    () => wipeIn(150),
    () => hotOpen(250),
    () => wait(100),
    () => sweep(k.text, k.size, 350),
    () => hotClose(150),
    () => hotOpen(150),
    () => wait(200),
    () => hotClose(150),
    () => wait(50),
    () => hotOpen(150),
    () => wait(1100),
    () => hotClose(150),
    () => wait(200),
    () => exit(250),
  ],
  grandslam: (k) => [
    () => wipeIn(150),
    () => hotOpen(250),
    () => wait(50),
    () => sweep(k.text, k.size, 250),
    () => hotClose(150),
    () => wait(150),
    () => hotOpen(150),
    () => wait(200),
    () => hotClose(150),
    () => wait(150),
    () => hotOpen(150),
    () => wait(250),
    () => sweep(k.text2 || 'HOME RUN', k.size, 250),
    () => wait(600),
    () => hotClose(150),
    () => wait(500),
    () => exit(250),
  ],
  strikeout: (k) => [
    () => wipeIn(150),
    () => dotsIn(),
    () => wait(250),
    () => dotsOut(),
    () => wait(200),
    () => fadeText(k.text, k.size, 220),
    () => wait(1700),
    () => exit(250),
  ],
};

async function start(kind) {
  const k = config[kind];
  if (!k?.enabled || !SEQUENCES[kind]) return;
  run += 1;
  const mine = run;
  reset();
  bar.hidden = false;
  for (const step of SEQUENCES[kind](k)) {
    if (mine !== run) return;
    await step();
  }
  if (mine === run) reset();
}

// ---------- Verbindung ----------

function onSnapshot(msg) {
  latest = msg;
  const id = fixedProfile ?? msg.layouts?.events ?? msg.profile ?? 'default';
  ensureProfile(id).then(() => {
    setLive(true);
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => setLive(false), STALE_MS);
    const ev = latest?.event ?? null;
    if (lastEventId === undefined) {
      // Erster Stand nach dem Verbinden: ein altes Ereignis nicht noch einmal zeigen
      lastEventId = ev ? ev.id : null;
      return;
    }
    if (ev && ev.id !== lastEventId) {
      lastEventId = ev.id;
      if (KINDS.includes(ev.kind)) start(ev.kind);
    }
  });
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
    if (msg.type === 'snapshot') onSnapshot(msg);
  });
  ws.addEventListener('close', () => {
    setLive(false);
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 5000);
  });
  ws.addEventListener('error', () => ws.close());
}

connect();
if (KINDS.includes(testKind)) {
  // Profil abwarten, dann einmal abspielen
  const timer = setInterval(() => {
    if (!latest) return;
    clearInterval(timer);
    start(testKind);
  }, 200);
}
