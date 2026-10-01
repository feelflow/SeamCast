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
  else if (key === 'h') act({ type: 'hit', bases: 1 });
  else if (['1', '2', '3', '4'].includes(key)) act({ type: 'hit', bases: Number(key) });
  else if (key === 'escape') send({ type: 'hideAll' });
  else return;
  event.preventDefault();
});

$('overlay-url').textContent = `${location.origin}/overlay/scoreboard.html`;
connect();
