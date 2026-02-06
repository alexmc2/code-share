---
applyTo: 'src/**/*.ts,src/**/*.tsx,public/**,index.html,vite.config.ts,tailwind.config.js,eslint.config.js'
excludeAgent: 'coding-agent'
---

# Frontend review focus

- Protect collaborative UX behavior across editor, chat, and whiteboard flows.
- Check React hooks for stale closures, missing cleanup, and unnecessary re-renders.
- Watch for Yjs synchronization regressions and awareness-state drift.
- Ensure user-facing errors are actionable and do not silently fail.
- Keep bundles lean; challenge unnecessary new dependencies.

# Yjs & persistence pitfalls

- Changes to Yjs shared-type names (e.g., `doc.getText('...')`, `doc.getMap('...')`) break compatibility with data already stored in IndexedDB — flag and require a migration strategy or version bump.
- `origin === 'remote'` guards in Yjs update listeners prevent echo loops — removing or altering these is high-risk.
- Awareness state cleanup must happen on unmount/disconnect; leaked awareness entries cause ghost cursors.

# Environment & config

- `src/lib/config.ts` reads `VITE_*` env vars at build time. Changes here affect all deployment targets — note which vars are new/removed.
- STUN/TURN server changes can silently break connectivity for users behind restrictive NATs.

# Frontend validation

- Run `npm run lint`.
- Run `npm run build`.
- For runtime-sensitive changes (WebRTC/session/sync), describe manual smoke checks in PR comments.
