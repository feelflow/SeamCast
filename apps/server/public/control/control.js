'use strict';

const $ = (id) => document.getElementById(id);
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

function render(msg) {
  last = msg;
  // Hat sich die Lage auf den Bases geändert (Undo, anderer Bediener), gilt die offene Auswahl nicht mehr.
  if (pending && pending.sig !== JSON.stringify(msg.game.bases)) cancelHit();
  const g = msg.game;
  $('sum-score').textContent = `${g.teams.away.short} ${g.score.away} : ${g.score.home} ${g.teams.home.short}`;
  const dots = g.half === 'top' ? '▲' : '▼';
  $('sum-state').textContent =
    `${dots} ${g.inning}. Inning · ${g.balls}-${g.strikes} · ${g.outs} Out · ` +
    `Bases ${g.bases.map((b, i) => (b ? i + 1 : '–')).join(' ')}`;
  $('lbl-away').textContent = `${g.teams.away.name} (Gast)`;
  $('lbl-home').textContent = `${g.teams.home.name} (Heim)`;
  g.bases.forEach((on, i) => ($(`base-btn-${i}`).dataset.on = String(on)));
  const fielding = g.half === 'top' ? 'home' : 'away';
  $('pitch-now').textContent = String(g.pitches[fielding]);
  $('pitch-who').textContent = `(${g.teams[fielding].short})`;
  $('undo').disabled = !msg.canUndo;
  $('toggle-scoreboard').dataset.on = String(msg.graphics.scoreboard);
  $('toggle-scoreboard').textContent = msg.graphics.scoreboard ? 'Scoreboard: AN' : 'Scoreboard: AUS';
  $('chip-overlays').textContent = `Overlays: ${msg.status.overlays}`;

  const select = $('rules');
  if (select.options.length === 0) {
    for (const rules of Object.values(msg.rules)) {
      const option = document.createElement('option');
      option.value = rules.id;
      option.textContent = `${rules.sport === 'softball' ? 'Softball' : 'Baseball'} · ${rules.innings} Innings`;
      select.append(option);
    }
  }
  select.value = g.rules.id;

  for (const side of ['away', 'home']) {
    const form = $(`team-${side}`);
    if (!form.contains(document.activeElement)) {
      form.elements.name.value = g.teams[side].name;
      form.elements.short.value = g.teams[side].short;
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

// --- Treffer mit Läufer-Auswahl ---------------------------------------------
// Regeln: Läufer gehen nie zurück, der Schlagmann überholt keinen Läufer und
// zwei Spieler stehen nie auf derselben Base. Nur erlaubte Ziele werden angeboten.
const HIT_NAMES = { 1: 'Single', 2: 'Double', 3: 'Triple', 4: 'Homerun' };
const BASE_NAMES = ['1B', '2B', '3B'];
let pending = null; // { sig, bases, runners: [{ from, end }] }  from: 1..3, end: from..4 (4 = Run)

function targetLabel(from, end) {
  if (end === from) return 'bleibt';
  return end >= 4 ? 'Run' : `→ ${BASE_NAMES[end - 1]}`;
}

/** Erlaubte Zielbases für Läufer k bei der aktuellen Auswahl der anderen. */
function options(k) {
  const behind = k === 0 ? pending.bases : pending.runners[k - 1].end;
  const from = pending.runners[k].from;
  const lowest = Math.max(from, behind >= 4 ? 4 : behind + 1);
  const result = [];
  for (let end = lowest; end <= 4; end++) result.push(end);
  return result;
}

function startHit(bases) {
  if (!last) return;
  const occupied = last.game.bases;
  if (bases === 4 || !occupied.some(Boolean)) {
    cancelHit();
    act({ type: 'hit', bases });
    return;
  }
  // Standard: Alle rücken so weit vor wie der Schlagmann.
  const runners = [];
  occupied.forEach((on, i) => on && runners.push({ from: i + 1, end: Math.min(i + 1 + bases, 4) }));
  pending = { sig: JSON.stringify(occupied), bases, runners };
  // Gibt es nichts zu entscheiden (z. B. beim Triple), sofort buchen.
  if (runners.every((_, k) => options(k).length === 1)) return confirmHit();
  renderRunners();
}

function cancelHit() {
  pending = null;
  $('runners').hidden = true;
}

function choose(k, end) {
  const runners = pending.runners;
  runners[k].end = end;
  // Wer vor dem Läufer steht, wird bei Bedarf mitgeschoben (nie zwei auf einer Base).
  for (let j = k + 1; j < runners.length; j++) {
    if (runners[j].end <= runners[j - 1].end && runners[j - 1].end < 4) runners[j].end = runners[j - 1].end + 1;
    else if (runners[j - 1].end >= 4) runners[j].end = 4;
  }
  renderRunners();
}

function renderRunners() {
  $('runners-title').textContent = `${HIT_NAMES[pending.bases]}: Wohin kommen die Läufer?`;
  const rows = $('runners-rows');
  rows.replaceChildren();
  pending.runners.forEach((runner, k) => {
    const row = document.createElement('div');
    row.className = 'runner-row';
    const label = document.createElement('span');
    label.textContent = BASE_NAMES[runner.from - 1];
    row.append(label);
    for (const end of options(k)) {
      const b = document.createElement('button');
      b.textContent = targetLabel(runner.from, end);
      b.setAttribute('aria-pressed', String(runner.end === end));
      b.addEventListener('click', () => choose(k, end));
      row.append(b);
    }
    rows.append(row);
  });
  $('runners-error').hidden = true;
  $('runners-ok').disabled = false;
  $('runners').hidden = false;
}

function confirmHit() {
  if (!pending) return;
  const advance = [0, 0, 0];
  for (const r of pending.runners) advance[r.from - 1] = r.end - r.from;
  act({ type: 'hit', bases: pending.bases, runners: advance });
  cancelHit();
}

document.querySelectorAll('button[data-hit]').forEach((button) =>
  button.addEventListener('click', () => startHit(Number(button.dataset.hit))),
);
$('runners-ok').addEventListener('click', confirmHit);
$('runners-cancel').addEventListener('click', cancelHit);

document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (button) act(JSON.parse(button.dataset.action));
});

for (let i = 0; i < 3; i++) {
  $(`base-btn-${i}`).addEventListener('click', () => {
    if (!last) return;
    const bases = [...last.game.bases];
    bases[i] = !bases[i];
    act({ type: 'setBases', bases });
  });
}

function pitchSide() {
  return last && last.game.half === 'top' ? 'home' : 'away';
}
$('pitch-minus').addEventListener('click', () => last && act({ type: 'adjustPitches', side: pitchSide(), delta: -1 }));
$('pitch-plus').addEventListener('click', () => last && act({ type: 'adjustPitches', side: pitchSide(), delta: 1 }));

// Vorschau in echter Streamgröße (1920x1080), verkleinert auf die Breite der Box
function fitPreview() {
  const box = $('preview-box');
  const scale = box.clientWidth / 1920;
  $('preview').style.transform = `scale(${scale})`;
  box.style.height = `${1080 * scale}px`;
}
window.addEventListener('resize', fitPreview);
fitPreview();

$('undo').addEventListener('click', () => send({ type: 'undo' }));
$('hide-all').addEventListener('click', () => send({ type: 'hideAll' }));
$('toggle-scoreboard').addEventListener('click', () => {
  if (last) send({ type: 'graphics', id: 'scoreboard', visible: !last.graphics.scoreboard });
});
$('new-pitcher').addEventListener('click', () => {
  if (confirm('Pitchzähler beider Mannschaften auf 0 setzen?')) act({ type: 'newPitcher' });
});
$('rules').addEventListener('change', (event) => act({ type: 'setRules', rulesId: event.target.value }));

for (const side of ['away', 'home']) {
  $(`team-${side}`).addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    act({ type: 'setTeam', side, name: form.elements.name.value, short: form.elements.short.value });
  });
}

document.addEventListener('keydown', (event) => {
  if (event.target.closest('input, select, textarea') || event.altKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey && key === 'z') || (!event.ctrlKey && key === 'u')) {
    send({ type: 'undo' });
  } else if (event.ctrlKey) {
    return;
  } else if (key === 'b') act({ type: 'ball' });
  else if (key === 's') act({ type: 'strike' });
  else if (key === 'f') act({ type: 'foul' });
  else if (key === 'o') act({ type: 'out' });
  else if (key === 'n') act({ type: 'newBatter' });
  else if (key === 'h') startHit(1);
  else if (['1', '2', '3', '4'].includes(key)) startHit(Number(key));
  else if (key === 'enter' && pending) confirmHit();
  else if (key === 'escape') {
    if (pending) cancelHit();
    else send({ type: 'hideAll' });
  }
  else return;
  event.preventDefault();
});

$('overlay-url').textContent = `${location.origin}/overlay/scoreboard.html`;
connect();
