'use strict';

const $ = (id) => document.getElementById(id);
let teams = [];
let selected = null; // Team-ID
let editing = null; // Team-ID im Formular, null = neu

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Fehler');
  return data;
}

let statusTimer = null;
function status(text) {
  const chip = $('status');
  chip.textContent = text;
  chip.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (chip.hidden = true), 3500);
}
const fail = (error) => status(error.message || 'Fehler');

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// --- Mannschaften -------------------------------------------------------------
async function loadTeams() {
  teams = await api('GET', '/api/teams');
  if (selected !== null && !teams.some((t) => t.id === selected)) selected = null;
  renderTeams();
  await loadPlayers();
}

function renderTeams() {
  const box = $('teams');
  box.replaceChildren();
  if (teams.length === 0) box.append(el('p', { className: 'hint', textContent: 'Noch keine Mannschaft angelegt.' }));
  for (const team of teams) {
    const item = el('div', { className: 'team-item' });
    item.setAttribute('aria-current', String(team.id === selected));
    const main = el(
      'div',
      { className: 'main' },
      el('div', { className: 'name', textContent: `${team.name} (${team.short})` }),
      el('div', { className: 'meta', textContent: `${team.league || 'ohne Liga'} · ${team.playerCount} Spieler` }),
    );
    item.append(main);
    if (team.own) item.append(el('span', { className: 'badge', textContent: 'eigene' }));
    const edit = el('button', { textContent: 'Ändern', type: 'button' });
    edit.addEventListener('click', (event) => {
      event.stopPropagation();
      startEditTeam(team);
    });
    const del = el('button', { textContent: 'Löschen', type: 'button' });
    del.addEventListener('click', async (event) => {
      event.stopPropagation();
      const text = team.playerCount
        ? `„${team.name}“ samt ${team.playerCount} Spielern löschen?`
        : `„${team.name}“ löschen?`;
      if (!confirm(text)) return;
      try {
        await api('DELETE', `/api/teams/${team.id}`);
        if (editing === team.id) resetTeamForm();
        await loadTeams();
      } catch (error) {
        fail(error);
      }
    });
    item.append(edit, del);
    item.addEventListener('click', () => {
      selected = team.id;
      renderTeams();
      loadPlayers();
    });
    box.append(item);
  }
}

const teamForm = $('team-form');

function startEditTeam(team) {
  editing = team.id;
  $('team-form-title').textContent = `Mannschaft ändern: ${team.name}`;
  teamForm.elements.name.value = team.name;
  teamForm.elements.short.value = team.short;
  teamForm.elements.league.value = team.league;
  teamForm.elements.logo.value = team.logo;
  teamForm.elements.own.checked = team.own;
  $('team-cancel').hidden = false;
  teamForm.elements.name.focus();
}

function resetTeamForm() {
  editing = null;
  teamForm.reset();
  $('team-form-title').textContent = 'Neue Mannschaft';
  $('team-cancel').hidden = true;
}

$('team-cancel').addEventListener('click', resetTeamForm);
teamForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = {
    name: teamForm.elements.name.value,
    short: teamForm.elements.short.value,
    league: teamForm.elements.league.value,
    logo: teamForm.elements.logo.value,
    own: teamForm.elements.own.checked,
  };
  try {
    const saved = editing === null ? await api('POST', '/api/teams', body) : await api('PUT', `/api/teams/${editing}`, body);
    selected = saved.id;
    resetTeamForm();
    await loadTeams();
    status('Gespeichert');
  } catch (error) {
    fail(error);
  }
});

// --- Spieler ------------------------------------------------------------------
async function loadPlayers() {
  const table = $('players');
  const body = table.tBodies[0];
  body.replaceChildren();
  const team = teams.find((t) => t.id === selected);
  table.hidden = !team;
  $('players-hint').hidden = Boolean(team);
  $('players-title').textContent = team ? `Spieler – ${team.name}` : 'Spieler';
  if (!team) return;
  const players = await api('GET', `/api/players?team=${team.id}`);
  for (const player of players) body.append(playerRow(team, player));
  body.append(playerRow(team, null));
}

function select(name, values, current) {
  const node = el('select', { name });
  for (const [value, label] of values) node.append(el('option', { value, textContent: label }));
  node.value = current;
  return node;
}

function playerRow(team, player) {
  const p = player ?? { lastName: '', firstName: '', number: null, bats: '', throws: '', nationality: '', externalId: '' };
  const row = el('tr', { className: player ? '' : 'fresh' });
  const input = (name, value, attrs = {}) => Object.assign(el('input', { name, value: value ?? '' }), attrs);
  const cell = (cls, node) => el('td', { className: cls }, node);

  const number = input('number', p.number, { type: 'number', min: 0, max: 999 });
  const last = input('lastName', p.lastName, { maxLength: 60, placeholder: player ? '' : 'Nachname' });
  const first = input('firstName', p.firstName, { maxLength: 60, placeholder: player ? '' : 'Vorname' });
  const bats = select('bats', [['', '–'], ['L', 'L'], ['R', 'R'], ['S', 'S']], p.bats);
  const throws = select('throws', [['', '–'], ['L', 'L'], ['R', 'R']], p.throws);
  const nat = input('nationality', p.nationality, { maxLength: 3 });
  const ext = input('externalId', p.externalId, { maxLength: 30 });

  const save = el('button', { type: 'button', textContent: player ? 'Speichern' : 'Hinzufügen' });
  const del = el('button', { type: 'button', textContent: 'Löschen' });
  const actions = el('td', { className: 'actions' }, save);
  if (player) actions.append(' ', del);

  row.append(cell('num', number), cell('', last), cell('', first), cell('hand', bats), cell('hand', throws), cell('nat', nat), cell('ext', ext), actions);
  row.addEventListener('input', () => row.classList.add('dirty'));

  const collect = () => ({
    teamId: team.id,
    lastName: last.value,
    firstName: first.value,
    number: number.value === '' ? null : Number(number.value),
    nationality: nat.value,
    bats: bats.value,
    throws: throws.value,
    externalId: ext.value,
  });
  const submit = async () => {
    try {
      if (player) await api('PUT', `/api/players/${player.id}`, collect());
      else await api('POST', '/api/players', collect());
      await loadTeams();
      status('Gespeichert');
      if (!player) $('players').tBodies[0].lastElementChild?.querySelector('input[name=number]')?.focus();
    } catch (error) {
      fail(error);
    }
  };
  save.addEventListener('click', submit);
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
      event.preventDefault();
      submit();
    }
  });
  del.addEventListener('click', async () => {
    if (!confirm(`${p.lastName} löschen?`)) return;
    try {
      await api('DELETE', `/api/players/${player.id}`);
      await loadTeams();
    } catch (error) {
      fail(error);
    }
  });
  return row;
}

loadTeams().catch(fail);
