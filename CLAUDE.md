# SeamCast – Arbeitsanleitung für Claude

Live-Grafiken für Baseball und Softball (Overlays als HTML für OBS/vMix/CasparCG, Bedienung im Browser).
Nachfolger des alten WinForms-Tools „Baseball-TV-Manager". Besitzer: Florian Heinicke (Laie, spricht Deutsch – Antworten auf Deutsch, kurz, ohne Fachjargon).

## Grundsatz
**Alles, was nach einem bestimmten Verein aussieht, ist Konfiguration und nie Code.** Farben, Schrift, Labels, Position, angezeigte Werte stehen in `config/profiles/*.json`, nicht im Quelltext.

## Aufbau
- `packages/core` – reine Spiellogik (Engine, Regelprofile baseball9/baseball7/softball7, Statistik-Formeln, Validierung, Roster-Typen, Access-Import-Plan). Keine I/O, gut getestet.
- `apps/server` – Node-Server (`node:http` + `ws`), SQLite über `node:sqlite`, REST für Kader/Import/Stats, WebSocket für Spielstand.
  - `public/overlay/` – Overlays (scoreboard, players, lineup), transparent, blenden sich bei Verbindungsverlust aus.
  - `public/control/` – Bedienung (helles Design, nur das Wichtigste fürs Spiel), `public/config/` – Einstellungen (Layout je Grafik, Grundprofil, Regeln, Mannschaften, Overlay-Adressen), `public/kader/` – Mannschaften/Spieler/Import.
- `docs/protocol.md` – WebSocket- und REST-Protokoll. **Bei jeder Protokolländerung mitpflegen.**
- Persistenz: `data/game.json` (Spielstand, Grafiken, Matchup, Aufstellungen) und `data/seamcast.db` (Kader, Statistiken; Migrationen über `PRAGMA user_version`).

## Befehle
- `pnpm install`, `pnpm start` (Port 8080), `pnpm typecheck`, `pnpm test` – vor jedem Commit müssen Typecheck und Tests grün sein.
- Windows-Start für den Nutzer: `start-seamcast.bat` (wechselt selbst auf `main` und holt Updates; der Nutzer muss nichts manuell tun, solange keine eigenen Änderungen im Ordner liegen).
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

## Stand der Dinge (fertig, auf `main`)
- Spiellogik: Balls/Strikes/Outs, Hits mit Läufer-Dialog (nur regelkonforme Optionen, Läufer-Out), Undo, „Neues Spiel", Regelprofile baseball9/baseball7/softball7.
- Scoreboard-Overlay (oben links, 1920×1080), ein Pitchcount (nur Feldteam).
- Kader-Datenbank (Teams, Spieler) mit Seite `/kader/`, Access-Import der alten Daten inkl. Statistik (wiederholbar).
- Scoreboard von Layout HDH: Design „bild" nach der Loopic-Vorlage „2023_Scoreboard" (Hintergrundbild `config/assets/scoreboard-hdh.jpg`, Textfelder und Maße im Profilabschnitt `scoreboard.bild`, Bühne 1920×1080; der Abschnitt `scoreboard` überschreibt nur das Scoreboard). Das ältere Design „tafel" bleibt im Code, wird aber von keinem Profil mehr genutzt; es gibt nur noch die Profile `default` (SeamCast Standard) und `hdh`, Spielerkarten Batter/Pitcher (`/overlay/players.html`), Aufstellung (`/overlay/lineup.html`).
- Eigene Einstellungsseite `/config/`: Scoreboard, Batter, Pitcher und Aufstellung haben je ein eigenes Layout (Profil) mit Live-Vorschau; „Grundprofil“ gilt für alle ohne eigene Wahl. Die Bedienung zeigt nur noch das Spielgeschehen (Einrichtung ist dorthin umgezogen).
- Bedienung im hellen Design, Windows-Start per `start-seamcast.bat`. Der Nutzer testet in OBS (läuft).
- Profil „Layout HDH“ (`config/profiles/hdh.json`): Pitcher-Karte (`layout: "table"`, senkrecht) und Batter-Karte (`layout: "wide"`, breit, mit Vereinslogo aus dem Kader und Position aus der Aufstellung unter der Nummer) nach seinen Loopic-Vorlagen, mit Einfahr-Animation und Sponsor-Logo. Bilder/Logos liegen in `config/assets/` und werden über `/assets/<Datei>` ausgeliefert (Profil: `logo`). Je Karte eigene `position` möglich.

## Themen und Backlog (Details stehen im jeweiligen GitHub-Issue)
Neue Aufgabe zu SeamCast: erst hier das passende Thema suchen, dann `gh api repos/feelflow/SeamCast/issues/<nr>` lesen. Nach Abschluss Issue schließen (im PR `Closes #<nr>`).

| # | Thema | Status | Wichtig zu wissen |
|---|-------|--------|-------------------|
| 6 | Bedienoberfläche aufräumen | PC-Teil fertig | Vorerst primär für die Bedienung am PC ausgelegt: Gruppen „Im Spiel / Grafiken / Einrichtung“, Vorschau (Scoreboard, Karten, Aufstellung) und Tastenkürzel rechts, Vorschau bleibt beim Scrollen sichtbar. Handy-Bedienung bewusst später (unter 1100 px nur Notlayout). Scoreboard-Ziffern verrutschen bei Innings ≥ 10 (bewusst vertagt). |
| 7 | Logos und Videos in den Grafiken | next | Logos kommen aus dem Kader (`logo` = reiner Dateiname). Videos (z. B. Opener) sollen in OBS/vMix laufen, CasparCG nicht mehr nötig. `LOGO_Opener` aus der Access-Datei noch nicht importiert. |
| 8 | Steuerung von OBS und vMix | idea | Szenen/Quellen schalten, Overlays automatisch ein- und ausblenden. Ziel: kein CasparCG. |
| 9 | Anmeldung und Zugriffsschutz | idea | Bisher nur Same-Origin-Check, Standard-Host 127.0.0.1. Nötig, sobald Betrieb im Netz/Handy-Bedienung. |
| 10 | Statistiken pro Spiel mitführen | idea | Aktuell nur importierte Saisonwerte. Live erfassen und in Saisonwerte übernehmen; Innings als Drittel. |
| 11 | Eigene Mannschaft markieren, Mehrmandanten | idea | Heideköpfe (Heidenheim) als „eigene Mannschaft" markieren (Nutzer hat das in Kader noch nicht getan). Mehrere Vereine über Profile/Konfiguration. |
| 12 | Softball-Besonderheiten | idea | Profil softball7 existiert; weitere Regeln und Anzeigen prüfen. |
| 13 | Installer / Start ohne Node-Kenntnisse | idea | Nutzer ist Laie; Windows. Heute: Node 22.13+ und pnpm nötig. Hinweis: pnpm 11 hat `minimumReleaseAge`, Lockfile mit pnpm 11 erzeugt. |
| 16 | Design-Wahl in der Bedienung | fertig | Unter „Spiel → Design" wählbar, Server speichert (`profile`), Overlays folgen, `?profile=` pinnt. Designs = JSON in `config/profiles/` (`design`: `modern`/`tafel`/`bild`, auch im Abschnitt `scoreboard`). Seit #27 je Grafik wählbar unter `/config/`; Layouts aufgeräumt: nur `default` und `hdh`. |
| 19 | Design-Import/-Export (Profil-Datei) | idea | Nutzer: „erstmal muss die App laufen" – nicht vorziehen. |
| 20 | Design-Pakete (ZIP mit Layout, Logos, Schriften) | idea | Setzt #19 voraus; importierter Code muss abgesichert werden. |
| 37 | Weitere Spielzüge und Spielende | idea | Offen: Dropped Third Strike, Final/Mercy Rule, Extra Innings (Softball-Tiebreaker), Interference. Schon da: Intentional Walk, Balk, Base Stealing (Steal/WP/PB/Caught Stealing), Out fragt bei Läufern nach dem Ziel (Sac Fly, Doppelspiel). |
| 14 | Lizenz und Markenprüfung | idea | Name „SeamCast", Produkt soll vermarktbar sein. Lizenz und Markenrecherche offen. |

| 22 | Anzeige der Spieler | fertig | Layout HDH für Pitcher- und Batter-Karte. Die Position (z. B. „3B“) kommt aus der Aufstellung des Spiels (`pos` je Slot), nicht aus dem Kader; steht der Spieler in keiner Aufstellung, bleibt die Zeile leer. Vereinslogo: Datei in `config/assets/`, Dateiname beim Team im Kader eintragen. Karten werden nie gleichzeitig gezeigt. Neue Vorlagen immer so lesen: Loopic-HTML parsen, Maße/Zeiten/Bilder extrahieren, als Layout nachbauen. |

Spielerkarten automatisch (Issue #31): Schlagmann = Aufstellung der schlagenden Mannschaft, Platz `game.batterIndex[Seite]`, rückt bei Out/Hit/Walk/Strikeout/HBP/„Neuer Batter“ weiter (Rückgängig stellt her); Pitcher = Slot `P` der Feldmannschaft, Wechsel per `pitcher`-Befehl oder durch anderes `P` in der Aufstellung (Pitchcount auf 0); in der Bedienung gibt es dafür keine Auswahl mehr. Ohne Aufstellung bleibt die Handauswahl (`select`).

Aufstellung von Layout HDH (Issue #33): Design „feld“ nach der Loopic-Vorlage „2023_Lineup“ – Vollbild 1920×1080 mit Stadionfoto (`config/assets/lineup-hdh.jpg`), Namensschild je Feldposition (`lineup-plate-hdh.png`), Maße/Reihenfolge im Profilabschnitt `lineup.feld`, Schilder erscheinen nacheinander (`stepMs`). Pro Position zählt der erste Eintrag; `EH` steht am DH-Platz; ohne Position erscheint der Spieler nicht. Es ist immer nur eine Mannschaft zu sehen (Gast, sonst Heim). Andere Profile behalten die Listen-Aufstellung.

Weitere Ideen (noch ohne Issue): Aufstellung automatisch mit aktuellem Schlagmann koppeln, Spielerfotos, Ergebnis-/Inning-Tabelle als Grafik, Tastaturkürzel erweitern, Bedienung am Handy (Layout für schmale Bildschirme, große Tasten; aus #6 ausgegliedert, nicht eilig; hängt mit #9 Zugriffsschutz zusammen).

## Nutzer
Florian Heinicke, Heidenheim Heideköpfe, Livestream-Grafiken. Laie: kurze deutsche Erklärungen, genaue Klickanleitungen (Windows, `start-seamcast.bat`), Ergebnisse lieber testen und zeigen als nur beschreiben. Er arbeitet oft am Handy und kann dann nichts ausprobieren – dann selbstständig weitermachen.
