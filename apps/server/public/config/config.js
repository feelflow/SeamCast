'use strict';

const $ = (id) => document.getElementById(id);
const GRAPHICS = ['scoreboard', 'batter', 'pitcher', 'lineup'];
let ws = null;
let last = null;
let retry = 500;
let errorTimer = null;

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}
const act = (action) => send({ type: 'action', action });

function showError(text) {
  const chip = $('chip-error');
  chip.textContent = text;
  chip.hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => (chip.hidden = true), 3000);
}

const nameOf = (msg, id) => msg.profiles.find((p) => p.id === id)?.name ?? id;

function render(msg) {
  last = msg;
  const sig = JSON.stringify(msg.profiles);

  // Grundprofil
  const base = $('design');
  if (base.dataset.sig !== sig) {
    base.dataset.sig = sig;
    base.replaceChildren(...msg.profiles.map((p) => new Option(p.name, p.id)));
  }
  base.value = msg.profile;

  // Layout je Grafik ("" = folgt dem Grundprofil)
  for (const graphic of GRAPHICS) {
    const select = document.querySelector(`select[data-layout="${graphic}"]`);
    const key = `${sig}|${msg.profile}`;
    if (select.dataset.sig !== key) {
      select.dataset.sig = key;
      select.replaceChildren(
        new Option(`Wie Grundprofil (${nameOf(msg, msg.profile)})`, ''),
        ...msg.profiles.map((p) => new Option(p.name, p.id)),
      );
    }
    select.value = msg.layouts?.[graphic] ?? '';
  }

  // Regeln
  const rules = $('rules');
  if (rules.options.length === 0) {
    for (const r of Object.values(msg.rules)) {
      rules.append(new Option(`${r.sport === 'softball' ? 'Softball' : 'Baseball'} · ${r.innings} Innings`, r.id));
    }
  }
  rules.value = msg.game.rules.id;

  // Mannschaften (nicht überschreiben, solange getippt wird)
  for (const side of ['away', 'home']) {
    const form = $(`team-${side}`);
    if (!form.contains(document.activeElement)) {
      form.elements.name.value = msg.game.teams[side].name;
      form.elements.short.value = msg.game.teams[side].short;
    }
  }
}

function connect() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${scheme}://${location.host}/ws?role=control`);
  ws.addEventListener('open', () => {
    retry = 500;
    $('chip-conn').textContent = 'Verbunden';
    $('chip-conn').dataset.ok = 'true';
  });
  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'snapshot') render(msg);
    else if (msg.type === 'error') showError(msg.message);
  });
  ws.addEventListener('close', () => {
    $('chip-conn').textContent = 'Getrennt – verbinde neu …';
    $('chip-conn').dataset.ok = 'false';
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 5000);
  });
  ws.addEventListener('error', () => ws.close());
}

// Vorschauen in echter Streamgröße (1920x1080), verkleinert auf die Breite ihrer Box
function fitPreviews() {
  for (const box of document.querySelectorAll('.pv')) {
    const scale = box.clientWidth / 1920;
    box.querySelector('.preview').style.transform = `scale(${scale})`;
    box.style.height = `${1080 * scale}px`;
  }
}
window.addEventListener('resize', fitPreviews);
fitPreviews();

for (const graphic of GRAPHICS) {
  document.querySelector(`select[data-layout="${graphic}"]`).addEventListener('change', (event) => {
    send({ type: 'layout', graphic, id: event.target.value === '' ? null : event.target.value });
  });
}
$('design').addEventListener('change', (event) => send({ type: 'profile', id: event.target.value }));
$('rules').addEventListener('change', (event) => act({ type: 'setRules', rulesId: event.target.value }));
for (const side of ['away', 'home']) {
  $(`team-${side}`).addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    act({ type: 'setTeam', side, name: form.elements.name.value, short: form.elements.short.value });
  });
}

// Mannschaften aus dem Kader übernehmen
let rosterTeams = [];
async function loadRoster() {
  try {
    const res = await fetch('/api/teams');
    if (!res.ok) return;
    rosterTeams = await res.json();
  } catch {
    return;
  }
  for (const side of ['away', 'home']) {
    const select = $(`pick-${side}`);
    select.replaceChildren(new Option('– wählen –', ''));
    for (const team of rosterTeams) select.append(new Option(`${team.name} (${team.short})`, String(team.id)));
  }
}
for (const side of ['away', 'home']) {
  $(`pick-${side}`).addEventListener('change', (event) => {
    const team = rosterTeams.find((t) => String(t.id) === event.target.value);
    if (team) act({ type: 'setTeam', side, name: team.name, short: team.short });
    event.target.value = '';
  });
}
loadRoster();
window.addEventListener('focus', loadRoster);

$('url-scoreboard').textContent = `${location.origin}/overlay/scoreboard.html`;
$('url-players').textContent = `${location.origin}/overlay/players.html`;
$('url-lineup').textContent = `${location.origin}/overlay/lineup.html`;
connect();
