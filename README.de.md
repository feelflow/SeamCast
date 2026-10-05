# SeamCast

**Live-Grafiken für Baseball und Softball** – Bedienung im Browser, HTML-Overlays für OBS, vMix und CasparCG.

> Stand: frühe Entwicklung (Phase 1 „Kern“). English: [README.md](README.md)

Grundsatz: Alles, was nach einem bestimmten Verein aussieht, ist **Konfiguration und nie Code**.

## Schnellstart

Voraussetzung: Node.js 22.13+ und pnpm. Die Daten (Spielstand, Mannschaften, Spieler) liegen im Ordner `./data` (SQLite-Datei `seamcast.db`).

```sh
pnpm install
pnpm start
```

- Bedienung: http://127.0.0.1:8080/control/
- Scoreboard-Overlay: http://127.0.0.1:8080/overlay/scoreboard.html (transparent, als Browserquelle in OBS/vMix einbinden)
- Anderes Design: in der Bedienung unter „Spiel → Design“ wählen, alle Overlays folgen (die Adressen bleiben gleich). Mit `?profile=<id>` in der Adresse lässt sich ein Overlay fest auf ein Design stellen. Eigene Designs sind JSON-Profile in `config/profiles/`; `"design"` wählt das Scoreboard-Layout (`modern`, `tafel` oder `bild` = nach Bildvorlage mit Maßen im Abschnitt `"bild"`), Farben und Beschriftungen stehen im selben Profil. Ein Abschnitt `"scoreboard"` im Profil überschreibt Einstellungen nur für das Scoreboard.
- Spielerkarten (Schlagmann/Pitcher): http://127.0.0.1:8080/overlay/players.html – Spieler wählst du in der Bedienung unter „Spielerkarten“, Werte stammen aus den importierten Saisonstatistiken.
- Line Up: http://127.0.0.1:8080/overlay/lineup.html – Schlagreihenfolge unter „Line Up bearbeiten“ in der Bedienung pflegen (wird automatisch gespeichert), dann mit den Knöpfen unter „Line Up“ einblenden.

Unter Windows reicht ein Doppelklick auf `start-seamcast.bat`: Sie aktualisiert, installiert, startet neu bei Absturz und öffnet die Bedienung im Browser.

Mannschaften und Spieler pflegst du unter http://127.0.0.1:8080/kader/ und übernimmst sie in der Bedienung per Auswahl „Gast/Heim aus Kader“.

Die alte Access-Datei des HTV-Managers importierst du auf derselben Seite (zuerst Vorschau, dann Import; wiederholbar). Statistik-Quoten (AVG, ERA …) rechnet SeamCast aus den Rohwerten selbst.

Umgebungsvariablen: `SEAMCAST_HOST` (Standard `127.0.0.1`), `SEAMCAST_PORT` (`8080`), `SEAMCAST_DATA` (`./data`).
Es gibt noch keine Anmeldung – im Zweifel nur lokal betreiben.

## Aufbau

Farben, Beschriftungen, Schrift und Position der Overlays stehen in JSON-Profilen unter `config/profiles/`
(`?profile=<id>` wählt eines). Die Spiellogik liegt in `packages/core` (rein, getestet); der Server in
`apps/server` hält den maßgeblichen Spielstand und sendet ihn per WebSocket. Siehe [docs/protocol.md](docs/protocol.md).

Tastatur in der Bedienung: `B` Ball, `S` Strike, `F` Foul, `O` Out, `1`–`4` Treffer, `N` neuer Batter, `U`/`Strg+Z` Rückgängig, `Esc` alles aus.
