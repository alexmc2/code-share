---
applyTo: '**'
excludeAgent: 'coding-agent'
---

# Architecture at a glance

- **P2P-first**: all collaborative content (code, chat, whiteboard) syncs over WebRTC data channels using Yjs CRDTs. The server is signalling-only.
- **Signalling server** (`server/`): Socket.IO — room membership, host election, and WebRTC offer/answer/ICE relay. Stores no user content.
- **Client** (`src/`): React + Vite SPA. Core layers: `signalling.ts` → `webrtc.ts` → `yjs-provider.ts` → `session.tsx` (context) → components.
- **Persistence**: `y-indexeddb` gives offline/rejoin state on the client; no server-side persistence.

# Code review baseline

- Prioritise correctness and regressions in real-time collaboration flows (session join/leave, peer lifecycle, Yjs sync, chat/whiteboard updates).
- Flag changes that weaken privacy assumptions or route shared content through the server.
- Flag breaking changes to signalling events, room membership logic, or host election behavior.
- Be explicit about risk level and impacted user flows in review comments.

# Findings format and severity

- Present findings first, ordered by severity: `critical`, `high`, `medium`, `low`.
- Each finding should include:
- `severity`
- impacted flow (for example: join room, whiteboard drag, undo/redo)
- concrete evidence with file references (`path:line`)
- why it matters (user impact or data/integrity risk)
- If there are no findings, say so explicitly and list residual risks or unverified areas.
- Avoid style-only nitpicks unless they hide correctness, performance, or maintainability risk.

# Whiteboard review checklist

- Treat image state as two coupled sources of truth: `Y.Array('whiteboard')` draw ops and `Y.Map('whiteboard-images')` binary data.
- For image add/delete/redo paths, verify `DrawOp` and image blob map updates happen in the same `doc.transact(...)` block to avoid dangling refs.
- Verify image deletion is individually undoable/redoable:
- Delete key removes only the selected image op.
- Undo restores both the image op and image bytes.
- Redo removes both again.
- Verify move/resize remains undoable/redoable independently from add/delete actions.
- Verify pointer capture and drag lifecycle are correct for mouse, pen, and touch.
- Verify selection overlay, handles, and image bounds stay aligned across zoom levels.
- Verify resize behavior is correct for corners vs edges, and any modifier overrides (for example `Shift`) behave as intended.
- Verify zoom/pan transforms are stable:
- repeated zoom-in/out should not drift unexpectedly
- clamping should not break drag/pan interactions
- viewport floor/limits should not create unreachable content regions
- Verify flood fill and background rendering stay visually consistent when zoomed out and when viewport shows outside-world regions.
- Flag any change where image placeholders can remain stale because viewport render runs without world-canvas rebuild after image decode completion.
- Flag UI regressions where move/resize has no in-progress visual feedback (preview + selection handles must render during drag).

# Client ↔ Server contract

- Socket.IO event names and payload shapes (see `SignallingEvents` in `signalling.ts` and the server's `io.on` handlers) are a shared contract — changes must land on both sides simultaneously.
- If either side adds/renames/removes an event, flag it and verify the counterpart is updated.

# Data compatibility and persistence

- Yjs shared type names are schema: changing keys like `doc.getArray('whiteboard')` or `doc.getMap('whiteboard-images')` can break persisted IndexedDB state.
- For schema-affecting changes, require a migration or explicit version/reset strategy.

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

# Manual smoke checks for risky UI changes

- For whiteboard interaction changes, include expected outcomes for:
- wheel zoom and pinch zoom
- spacebar hand-pan
- image drag and resize (corner and edge paths)
- undo/redo after add/move/resize/delete
- fill behavior near world edges and at min zoom
