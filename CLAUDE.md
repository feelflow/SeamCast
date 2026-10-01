# SeamCast – Arbeitsanleitung für Claude

Live-Grafiken für Baseball und Softball (Overlays als HTML für OBS/vMix/CasparCG, Bedienung im Browser).
Nachfolger des alten WinForms-Tools „Baseball-TV-Manager". Besitzer: Florian Heinicke (Laie, spricht Deutsch – Antworten auf Deutsch, kurz, ohne Fachjargon).

## Grundsatz
**Alles, was nach einem bestimmten Verein aussieht, ist Konfiguration und nie Code.** Farben, Schrift, Labels, Position, angezeigte Werte stehen in `config/profiles/*.json`, nicht im Quelltext.

## Aufbau
- `packages/core` – reine Spiellogik (Engine, Regelprofile baseball9/baseball7/softball7, Statistik-Formeln, Validierung, Roster-Typen, Access-Import-Plan). Keine I/O, gut getestet.
- `apps/server` – Node-Server (`node:http` + `ws`), SQLite über `node:sqlite`, REST für Kader/Import/Stats, WebSocket für Spielstand.
  - `public/overlay/` – Overlays (scoreboard, players, lineup), transparent, blenden sich bei Verbindungsverlust aus.
  - `public/control/` – Bedienung (helles Design), `public/kader/` – Mannschaften/Spieler/Import.
- `docs/protocol.md` – WebSocket- und REST-Protokoll. **Bei jeder Protokolländerung mitpflegen.**
- Persistenz: `data/game.json` (Spielstand, Grafiken, Matchup, Aufstellungen) und `data/seamcast.db` (Kader, Statistiken; Migrationen über `PRAGMA user_version`).

## Befehle
- `pnpm install`, `pnpm start` (Port 8080), `pnpm typecheck`, `pnpm test` – vor jedem Commit müssen Typecheck und Tests grün sein.
- Windows-Start für den Nutzer: `start-seamcast.bat`.
- Manuell prüfen: `SEAMCAST_PORT=8099 SEAMCAST_DATA=/tmp/x pnpm start`, beenden mit `fuser -k 8099/tcp` (nicht `pkill -f`, das killt die eigene Shell). Screenshots mit Playwright und `/opt/pw-browsers/chromium`.

## Regeln für Änderungen
- Server ist maßgeblich für den Spielstand; Clients senden Befehle, der Server sendet vollständige Snapshots (bei jeder Änderung und alle 15 s).
- Eingaben immer validieren (Same-Origin-Check, Content-Type, Längen, Wertebereiche). Neue Funktion → Tests, auch für Fehlerfälle.
- Kein neuer Code mit Vereinsnamen, Farben oder Logos – immer über Profil/Datenbank.
- Statistik-Quoten werden aus Rohwerten berechnet (Innings als Drittel gespeichert), nie importierte Quoten verwenden.
- Access-Import: `Players.TeamShort` enthält in Wahrheit den Teamnamen; Re-Import ist ein Upsert. Details in `apps/server/src/importer.ts`.

## Git
- Ein Thema = ein Branch (`feat/...`, `docs/...`) = ein PR. Das zugehörige Issue wird im PR verlinkt.
- PRs mit `gh api repos/feelflow/SeamCast/pulls` anlegen (GraphQL ist gesperrt).
- Vor dem Push `git fetch origin main`; für neue Branches ggf. `git config --add remote.origin.fetch '+refs/heads/<branch>:refs/remotes/origin/<branch>'`.

## Backlog
Steht in den GitHub Issues (Label `idea`, `next`, `doing`). Hier nichts doppelt pflegen.
