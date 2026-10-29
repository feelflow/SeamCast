'use strict';

const $ = (id) => document.getElementById(id);
const GRAPHICS = ['scoreboard', 'batter', 'pitcher', 'lineup', 'events'];
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

const labelOf = (p) => (p.custom ? `${p.name} (eigenes)` : p.name);
const nameOf = (msg, id) => {
  const p = msg.profiles.find((x) => x.id === id);
  return p ? labelOf(p) : id;
};

function render(msg) {
  last = msg;
  const sig = JSON.stringify(msg.profiles);

  // Grundprofil
  const base = $('design');
  if (base.dataset.sig !== sig) {
    base.dataset.sig = sig;
    base.replaceChildren(...msg.profiles.map((p) => new Option(labelOf(p), p.id)));
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
        ...msg.profiles.map((p) => new Option(labelOf(p), p.id)),
      );
    }
    select.value = msg.layouts?.[graphic] ?? '';
  }

  // Designs teilen
  const exportSelect = $('export-design');
  if (exportSelect.dataset.sig !== sig) {
    const keep = exportSelect.value;
    exportSelect.dataset.sig = sig;
    exportSelect.replaceChildren(...msg.profiles.map((p) => new Option(labelOf(p), p.id)));
    if (keep) exportSelect.value = keep;
    const list = $('custom-list');
    const custom = msg.profiles.filter((p) => p.custom);
    list.replaceChildren(
      ...(custom.length
        ? custom.map((p) => {
            const row = document.createElement('div');
            row.className = 'custom-row';
            const name = document.createElement('span');
            name.textContent = p.name;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = 'Löschen';
            remove.addEventListener('click', () => deleteDesign(p));
            row.append(name, remove);
            return row;
          })
        : [Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Noch keine importierten Designs.' })]),
    );
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
$('url-events').textContent = `${location.origin}/overlay/events.html`;
for (const button of document.querySelectorAll('button[data-test]')) {
  button.addEventListener('click', () => send({ type: 'event', kind: button.dataset.test }));
}
connect();

// --- Designs exportieren, importieren, löschen --------------------------------------
function importMessage(text, ok) {
  const el = $('import-result');
  el.textContent = text;
  el.dataset.ok = String(ok);
  el.hidden = false;
}

function downloadDesign(query, extension) {
  const id = $('export-design').value;
  if (!id) return;
  const link = document.createElement('a');
  link.href = `/api/profiles/${encodeURIComponent(id)}?${query}=1`;
  link.download = `seamcast-design-${id}.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
}
$('export-btn').addEventListener('click', () => downloadDesign('download', 'json'));
$('export-pack').addEventListener('click', () => downloadDesign('package', 'zip'));

$('import-file').addEventListener('change', async (event) => {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const isZip = /\.zip$/i.test(file.name);
    if (file.size > (isZip ? 20 * 1024 * 1024 : 128 * 1024)) {
      importMessage('Die Datei ist zu groß für ein Design.', false);
      return;
    }
    const overwrite = $('import-overwrite').checked ? '?overwrite=1' : '';
    const res = await fetch(`/api/profiles${overwrite}`, {
      method: 'POST',
      headers: { 'Content-Type': isZip ? 'application/zip' : 'application/json' },
      body: isZip ? await file.arrayBuffer() : await file.text(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      importMessage(body.exists ? `${body.error} Häkchen „ersetzen“ setzen oder den Namen in der Datei ändern.` : (body.error ?? 'Import fehlgeschlagen.'), false);
      return;
    }
    let message = `„${body.name}“ ${body.replaced ? 'ersetzt' : 'importiert'}${body.images ? ` (${body.images} Bilder)` : ''}. Du findest es jetzt in den Layout-Listen.`;
    if (body.missingAssets && body.missingAssets.length) {
      message += ` Es fehlen noch Bilder in config/assets: ${body.missingAssets.join(', ')}`;
    }
    importMessage(message, true);
  } catch {
    importMessage('Die Datei konnte nicht gelesen werden.', false);
  } finally {
    input.value = '';
  }
});

async function deleteDesign(profile) {
  const res = await fetch(`/api/profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' });
  const body = await res.json().catch(() => ({}));
  importMessage(res.ok ? `„${profile.name}“ gelöscht.` : (body.error ?? 'Löschen fehlgeschlagen.'), res.ok);
}
