# SeamCast

**Live Graphics for Baseball and Softball** – browser-based control, HTML overlays for OBS, vMix and CasparCG.

> Status: early development (phase 1, "core"). Deutsch: [README.de.md](README.de.md)

Principle: everything that makes a graphic look like a specific club is **configuration, never code**.

## Quick start

Requires Node.js 22.13+ and pnpm. Data (game state, teams, players) is stored in `./data` (SQLite file `seamcast.db`).

```sh
pnpm install
pnpm start
```

- Control page: http://127.0.0.1:8080/control/
- Scoreboard overlay: http://127.0.0.1:8080/overlay/scoreboard.html (transparent; add as browser source in OBS/vMix)
- Other design: pick it on the control page under "Spiel → Design"; all overlays follow (URLs stay the same). Appending `?profile=<id>` pins an overlay to one design. Custom designs are JSON profiles in `config/profiles/`; `"design"` picks the scoreboard layout (`modern` or `tafel`), colors and labels live in the same profile. A `"scoreboard"` section in a profile overrides settings for the scoreboard only.
- Batter/pitcher cards: http://127.0.0.1:8080/overlay/players.html – pick players on the control page under "Spielerkarten"; values come from imported season stats.
- Lineups: http://127.0.0.1:8080/overlay/lineup.html – set the batting order under "Aufstellung" on the control page, save, then show.

Manage teams and players at http://127.0.0.1:8080/kader/; pick them for a game on the control page.

The old HTV-Manager Access file can be imported on the same page (preview first, repeatable). Rates (AVG, ERA, …) are computed from raw counts.

Environment: `SEAMCAST_HOST` (default `127.0.0.1`), `SEAMCAST_PORT` (`8080`), `SEAMCAST_DATA` (`./data`).
There is no login yet – keep the default loopback binding unless you are on a trusted network.

## Design

Overlay colors, labels, fonts and position come from JSON profiles in `config/profiles/`
(`?profile=<id>` selects one). Game logic lives in `packages/core` (pure, tested); the server in
`apps/server` keeps the authoritative state and pushes snapshots over WebSocket. See [docs/protocol.md](docs/protocol.md).

```sh
pnpm test        # unit + server tests
pnpm typecheck
```

Keyboard on the control page: `B` ball, `S` strike, `F` foul, `O` out, `1`-`4` hits, `N` new batter, `U`/`Ctrl+Z` undo, `Esc` hide all.
