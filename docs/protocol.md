# Protocol (v1)

WebSocket: `ws://host:port/ws?role=overlay|control|preview` (same-origin only; default role `overlay`).

Server → client, on every change and every 15 s as heartbeat:
`{type:"snapshot", protocol:1, game, canUndo, graphics:{scoreboard:boolean}, status:{overlays,controls}, rules}`

Client (role `control` only) → server:
- `{type:"action", action}` – see `parseAction` in `packages/core/src/validate.ts`
- `{type:"undo"}`
- `{type:"graphics", id:"scoreboard", visible:boolean}`
- `{type:"hideAll"}`

Invalid input is answered with `{type:"error", message}`. HTTP: `GET /api/state`, `GET /api/profiles/<id>`.
Overlays hide themselves while disconnected or when no snapshot arrives for 40 s.
