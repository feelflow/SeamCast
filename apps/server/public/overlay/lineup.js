'use strict';

const params = new URLSearchParams(location.search);
const role = params.get('role') === 'preview' ? 'preview' : 'overlay';
// Mit ?profile=… in der Adresse bleibt das Profil fest; sonst folgt das Overlay dem Layout dieser Grafik (Konfigurationsseite), ersatzweise dem Grundprofil.
const fixedProfile = /^[a-z0-9-]{1,40}$/.test(params.get('profile') ?? '') ? params.get('profile') : null;
let loadedProfile = null;
let latest = null;
let feld = null;
let feldSignature = '';

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
  const lu = p.lineup && typeof p.lineup === 'object' ? p.lineup : null;
  feld = lu && lu.design === 'feld' && lu.feld && typeof lu.feld === 'object' ? lu.feld : null;
  body.dataset.design = feld ? 'feld' : 'modern';
  if (feld) setupFeld();
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

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const safeFile = (v) => (typeof v === 'string' && /^[\w.-]{1,100}$/.test(v) ? v : null);

/** Design „feld“: Hintergrund und Titel einmal an die Maße aus dem Profil setzen. */
function setupFeld() {
  const back = $('f-back');
  const b = feld.back ?? {};
  const image = safeFile(b.image);
  if (image) back.src = `/assets/${image}`;
  back.hidden = !image;
  back.style.left = `${num(b.x, 0)}px`;
  back.style.top = `${num(b.y, 0)}px`;
  back.style.width = `${num(b.width, 1920)}px`;
  back.style.height = `${num(b.height, 1080)}px`;
  const t = feld.title ?? {};
  const label = $('f-label');
  const team = $('f-team');
  label.textContent = typeof t.label === 'string' ? t.label : '';
  for (const [el, y, size] of [[label, t.labelY, t.labelSize], [team, t.teamY, t.teamSize]]) {
    el.style.left = `${num(t.centerX, 960)}px`;
    el.style.top = `${num(y, 100)}px`;
    el.style.fontSize = `${num(size, 40)}px`;
  }
  team.style.textTransform = t.uppercase === false ? 'none' : 'uppercase';
  const family = feld.font && typeof feld.font.family === 'string' ? feld.font.family : null;
  $('feld').style.fontFamily = family ?? '';
}

/** Ein Namensschild: Schild-Bild, Position, Vor- und Nachname. Zu lange Namen werden schmaler gestaucht. */
function plateElement(row, spot, plate, delay) {
  const item = document.createElement('div');
  item.className = 'f-item';
  item.style.left = `${num(spot.x, 0)}px`;
  item.style.top = `${num(spot.y, 0)}px`;
  item.style.setProperty('--delay', `${delay}ms`);
  const color = typeof plate.color === 'string' ? plate.color : '#ffffff';
  item.style.color = color;
  const image = safeFile(plate.image);
  if (image && spot.plate !== false) {
    const img = document.createElement('img');
    img.className = 'f-plate';
    img.src = `/assets/${image}`;
    img.alt = '';
    img.style.width = `${num(plate.width, 343)}px`;
    img.style.height = `${num(plate.height, 77)}px`;
    item.append(img);
  }
  const pos = document.createElement('div');
  pos.className = 'f-pos';
  pos.textContent = row.pos;
  pos.style.width = `${num(plate.posWidth, 103)}px`;
  pos.style.top = `${num(plate.posY, 7)}px`;
  pos.style.fontSize = `${num(plate.posSize, 50)}px`;
  item.append(pos);
  const size = num(plate.nameSize, 22);
  const avail = num(plate.width, 343) - num(plate.nameX, 121) - 6;
  const names = [['f-first', row.firstName, num(plate.firstY, 12)], ['f-last', row.lastName, num(plate.lastY, 39)]];
  const made = names.map(([cls, text, y]) => {
    const el = document.createElement('div');
    el.className = `f-name ${cls}`;
    el.textContent = text;
    el.style.left = `${num(plate.nameX, 121)}px`;
    el.style.top = `${y}px`;
    el.style.fontSize = `${size}px`;
    item.append(el);
    return el;
  });
  return { item, made, avail };
}

function renderFeld(msg) {
  const g = msg.graphics ?? {};
  const awayOn = Boolean(g.lineupAway);
  const homeOn = Boolean(g.lineupHome);
  // Es ist immer nur eine Mannschaft zu sehen: Gast, sonst Heim; in der Vorschau ohne Einblendung die erste mit Aufstellung.
  const side = awayOn ? 'away' : homeOn ? 'home' : (msg.lineups?.away?.length ? 'away' : 'home');
  const rows = msg.lineups?.[side] ?? [];
  $('f-team').textContent = msg.game.teams[side].name;
  const plate = feld.plate ?? {};
  const spots = feld.positions ?? {};
  const order = Array.isArray(feld.order) ? feld.order : Object.keys(spots);
  const step = num(feld.stepMs, 60);
  const used = new Set();
  const built = [];
  for (const row of rows) {
    // Ein DH/EH steht am DH-Platz; pro Platz zählt nur der erste Eintrag.
    const key = row.pos === 'EH' && spots.DH ? 'DH' : row.pos;
    if (!spots[key] || used.has(key)) continue;
    used.add(key);
    const idx = order.indexOf(key);
    built.push(plateElement(row, spots[key], plate, Math.max(0, idx) * step));
  }
  const signature = JSON.stringify([loadedProfile, side, rows]);
  if (signature !== feldSignature) {
    feldSignature = signature;
    $('f-items').replaceChildren(...built.map((b) => b.item));
    for (const b of built) {
      for (const el of b.made) {
        const need = el.scrollWidth;
        if (b.avail > 0 && need > b.avail) el.style.transform = `scaleX(${b.avail / need})`;
      }
    }
    // Neu aufgebaute Schilder erst im Ausgangszustand zeichnen, damit das Einblenden nacheinander läuft
    void $('feld').offsetWidth;
  }
  const shown = side === 'away' ? awayOn : homeOn;
  $('feld').dataset.show = shown ? 'true' : 'false';
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
      setLive(true);
      renderSide('away', latest);
      renderSide('home', latest);
      if (feld) renderFeld(latest);
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
