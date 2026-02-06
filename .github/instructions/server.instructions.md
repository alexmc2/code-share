---
applyTo: 'server/**/*.ts,server/**/*.js,server/package.json,server/tsconfig.json,server/eslint.config.js'
excludeAgent: 'coding-agent'
---

# Server review focus

- Treat the signalling service as stateful and long-lived; flag stateless/serverless assumptions.
- Protect Socket.IO room membership, host election, and signalling message integrity.
- Verify CORS and origin-handling changes do not broaden access unintentionally.
- Ensure server changes never store or process collaborative content beyond signalling metadata.

# Host election & room lifecycle

- Host = peer with the earliest `joinedAt` timestamp. Changes to `getHostId()` or `joinedAt` assignment affect who is authoritative — test with multi-peer join/leave sequences.
- The duplicate-peerId kick path (`kicked` event) is a reconnection safeguard — removing or loosening it can cause split-brain state.
- Room cleanup runs on an interval (`ROOM_CLEANUP_INTERVAL`); changes to timing or conditions should consider rooms that are briefly empty during reconnects.

# Server validation

- Run `npm --prefix server run lint`.
- Run `npm --prefix server run build`.
- If server contract changes affect client behavior, ask for coordinated client validation notes.
