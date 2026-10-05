# Protocol (v1)

WebSocket: `ws://host:port/ws?role=overlay|control|preview` (same-origin only; default role `overlay`).

Server → client, on every change and every 15 s as heartbeat:
`{type:"snapshot", protocol:1, game, canUndo, graphics:{scoreboard,batter,pitcher:boolean}, matchup:{batter,pitcher:{away,home:playerId|null}}, cards:{batter,pitcher:Card|null}, status:{overlays,controls}, rules}`

Client (role `control` only) → server:
- `{type:"action", action}` – see `parseAction` in `packages/core/src/validate.ts`
- `{type:"undo"}`
- `{type:"graphics", id:"scoreboard"|"batter"|"pitcher", visible:boolean}`
- `{type:"select", role:"batter"|"pitcher", side:"away"|"home", playerId:number|null}` – picks the player per side; the batter card shows the batting side's pick, the pitcher card the fielding side's. Unknown ids are rejected.
- `{type:"lineup", side, slots:[{playerId, pos}]}` – batting order of a team (max 12, unique players, `pos` ≤ 3 chars); snapshot field `lineups:{away,home:[{order,playerId,number,firstName,lastName,pos}]}`; graphic ids `lineupAway` / `lineupHome`
- `{type:"profile", id}` – selects the graphics profile (design) for all overlays; snapshot fields `profile` (current id) and `profiles:[{id,name}]`. Overlays opened with `?profile=<id>` ignore the selection.
- `{type:"hideAll"}`

Invalid input is answered with `{type:"error", message}`. HTTP: `GET /api/state`, `GET /api/profiles/<id>`, `GET /assets/<file>` (Bilddatei aus `config/assets/`, nur reiner Dateiname mit png/jpg/webp/svg; z. B. Sponsor-Logo).

Profil `cards.<batter|pitcher>`: `layout` (`row` = waagerecht, Standard; `table` = senkrechte Karte mit Wertetabelle), `logo` (Dateiname in `config/assets/`), `position` (`top-left`/`top-right`/`bottom-left`/`bottom-right`; ohne Angabe reiht sich die Karte in die Gruppe `cards.position` ein), `stats` (`[Schlüssel, Beschriftung]`). Kennzahl-Schlüssel des Pitchers u. a. `era`, `whip`, `ip`, `so`, `wl` (Siege-Niederlagen, z. B. `7-1`).
Overlays hide themselves while disconnected or when no snapshot arrives for 40 s.

## Roster API (JSON over HTTP)

- `GET /api/teams`, `POST /api/teams`, `PUT|DELETE /api/teams/<id>`
- `GET /api/players[?team=<id>]`, `POST /api/players`, `PUT|DELETE /api/players/<id>`

Writes require `Content-Type: application/json` and a same-origin `Origin` header. Errors: `400` invalid input,
`404` not found, `409` duplicate (team name per league, external player id). Input rules: `parseTeamInput` /
`parsePlayerInput` in `packages/core/src/roster.ts`. Storage: SQLite (`seamcast.db`), schema migrations in `apps/server/src/db.ts`.

- `GET /api/players/<id>/stats` – batting and pitching lines per round with computed rates, plus totals
- `POST /api/import/access[?dryRun=1]` – body: the `.accdb` file (`application/octet-stream`, max 50 MB); responds with an import report. Teams are matched by name, players by league id, stats by player/season/round, so imports can be repeated.
