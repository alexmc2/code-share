---
applyTo: '**'
excludeAgent: 'coding-agent'
---

# Architecture at a glance

- **P2P-first**: all collaborative content (code, chat, whiteboard) syncs over WebRTC data channels using Yjs CRDTs. The server is signalling-only.
- **Signalling server** (`server/`): Socket.IO — room membership, host election, and WebRTC offer/answer/ICE relay. Stores no user content.
- **Client** (`src/`): React + Vite SPA. Core layers: `signalling.ts` → `webrtc.ts` → `yjs-provider.ts` → `session.tsx` (context) → components.
- **Persistence**: `y-indexeddb` gives offline/rejoin state on the client; no server-side persistence.

# Code review-only baseline

- Prioritise correctness and regressions in real-time collaboration flows (session join/leave, peer lifecycle, Yjs sync, chat/whiteboard updates).
- Flag changes that weaken privacy assumptions or route shared content through the server.
- Flag breaking changes to signalling events, room membership logic, or host election behavior.
- Be explicit about risk level and impacted user flows in review comments.

# Client ↔ Server contract

- Socket.IO event names and payload shapes (see `SignallingEvents` in `signalling.ts` and the server's `io.on` handlers) are a shared contract — changes must land on both sides simultaneously.
- If either side adds/renames/removes an event, flag it and verify the counterpart is updated.

# Validation expectations

- If root/client files change, run:
  - `npm run lint`
  - `npm run build`
- If `server/` files change, run:
  - `npm --prefix server run lint`
  - `npm --prefix server run build`
- If both areas change, run all four commands.
- If `docker-compose.yml`, `Dockerfile.*`, or `nginx.conf` change, verify the build still works with `docker compose build`.
- In review summaries, state which commands were run and any skipped checks.
