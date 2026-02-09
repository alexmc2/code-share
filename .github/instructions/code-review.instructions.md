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

## Selection & movement (images + drawings)

- The select tool works on both images **and** drawing ops (path, line, rect, circle). Selectable types are defined in `SELECTABLE_TYPES` in `useImageSelect.ts`.
- `useImageSelect` is the unified hook for selecting, moving, resizing, and deleting any selectable op — despite its legacy name it handles drawings too.
- Moving an op removes it from its original position and pushes it to the **end** of `opsArray`, bringing it to the top of z-order within its layer. Verify this holds for both images and drawings.
- Resize (drag handles) is available for all selectable ops (images and drawings). Corner handles scale both axes (uniform for drawings, aspect-ratio-locked for images unless Shift held). Side handles scale horizontally only; top/bottom handles scale vertically only.
- `scaleOp()` creates a scaled copy of any op relative to an anchor point. For path ops it scales every point; for shapes it scales `x1/y1/x2/y2`. Verify edge cases: paths with a single point, zero-width/zero-height bounding boxes.
- Associated fill ops: when a drawing op is selected, fill ops whose start point `(x1, y1)` falls within the drawing's bounding box are treated as grouped. On move/delete they translate/remove together.
- Grouped transforms use `UndoEntry.groupedOps[]` to record the fill ops that moved or were deleted alongside the primary op. Undo/redo must restore or re-apply all ops in the group atomically.
- Canvas suppression during drag uses `setSuppressedOpIds(Set<string>)` which suppresses rendering of any op ID in the set (primary + grouped fills). Verify the set is cleared (`null`) on drag end and deselect.

## Deletion

- Verify deletion of images is individually undoable/redoable:
  - Delete key removes only the selected image op.
  - Undo restores both the image op and image bytes.ug
  - Redo removes both again.
- Verify deletion of drawing ops also deletes grouped fill ops and records them in `UndoEntry.groupedOps` for undo/redo.
- Verify move/resize remains undoable/redoable independently from add/delete actions.

## Drawing op movement specifics

- `translateOp()` creates a coordinate-shifted copy of any op. For path ops it shifts every point; for shapes it shifts `x1/y1/x2/y2`. Verify edge cases: paths with a single point, circles at canvas edges.
- `getOpBounds()` computes axis-aligned bounding boxes for all selectable types (including circle radius expansion). Used for selection overlay, hit-test grouping of fills, and canvas-boundary clamping during move.
- `hitTestDrawingOp()` uses point-to-segment distance for paths/lines and bounding-box/radius checks for rects/circles. Hit padding scales inversely with zoom (`5 / transform.scale`).
- Preview during drawing move: the drawing op is rendered via `drawStrokeOp()` in the overlay renderer. Fill ops are not previewed during drag (they reappear on release after world-canvas rebuild). This is expected behavior.

## Layer ordering (imagesOnTop toggle)

- When `imagesOnTop` is true, images always render above all drawings regardless of array order. Within the image layer, later ops render on top.
- When `imagesOnTop` is false ("respect order" mode), ops render in array order. Moving any op pushes it to the end of the array, making it render on top of everything.
- The toggle is a CRDT-synced shared setting via `Y.Map('whiteboard-settings')`. Changes propagate to all peers.
- Verify that the layer toggle interacts correctly with move z-ordering: a moved drawing should not appear above images when `imagesOnTop` is true.

## Visual and interaction integrity

- Verify pointer capture and drag lifecycle are correct for mouse, pen, and touch.
- Verify selection overlay, handles, and bounding box stay aligned across zoom levels for both images and drawings.
- Verify resize behavior is correct for corners vs edges, and any modifier overrides (for example `Shift`) behave as intended. For images, corners lock aspect ratio by default. For drawings, corners scale uniformly.
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
  - drawing op drag (path, line, rect, circle) — verify bounding box clamping at canvas edges
  - drawing op resize (corner, side, top/bottom) — verify path point scaling, min size enforcement
  - grouped fill movement — fill ops inside a drawing's bounds should translate and snap back on undo
  - z-order after move: moved image/drawing appears on top of siblings; layer toggle is respected
  - undo/redo after add/move/resize/delete for both images and drawings (including grouped fills)
  - delete key on selected drawing vs selected image
  - fill behavior near world edges and at min zoom
