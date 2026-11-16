# Plan review — gaps found and fixed

**Reviewed:** `PLAN.md` against `00`–`16`, the ADRs and `REVIEW.md`.
**Method:** walk every requirement → plan task; walk every phase exit → prerequisites; check operational/recovery/UI paths.

---

## 1. Verdict

The plan covers all P0/P1 capabilities but under-specified several **integration seams** that would have caused rework: frontend bootstrap before Phase 9, CSRF/session bootstrap, SSR-less static serving, restore UX, AI degraded UI, and the editor's local draft recovery. Those are added below and in `PLAN.md`.

No phase is missing. The order remains correct: the app is usable after Phase 2 and fully usable without AI after Phase 5.

## 2. Findings

### Blocking if unfixed

| # | Gap | Fix in plan |
| --- | --- | --- |
| B1 | No task for the Vite entry (`index.html`, `main.tsx`) and production static fallback; the server could not serve the app until Phase 9. | Added **P0.10 SPA scaffold**: index.html with pre-paint theme script, main.tsx, placeholder route, dev proxy, static build served by Fastify with SPA fallback that excludes `/api`. |
| B2 | Auth flow omitted the client bootstrap: setup-required detection, CSRF token retrieval after login, 401 redirect, cookie clearing on logout. | Added to **P0.7** (server) and **P9.2/P9.3** (client): session bootstrap hook, CSRF cookie read, global 401 → login with return path. |
| B3 | No dependency installation/lockfile verification task; "scaffold" assumed installs succeed. | Added **P0.1a**: pin versions, install, verify native `better-sqlite3` loads, commit lockfile. |
| B4 | Editor draft recovery was described in UX docs but absent from the plan. | Added **P9.7**: localStorage draft per note, flush on `visibilitychange`, recovery banner, conflict dialog paths. |
| B5 | Restore UX (typed confirmation, maintenance state, forced re-login, warning on key fingerprint) was not a task. | Added **P9.14** restore flow and **P8.3** relogin/maintenance assertions. |
| B6 | No task for serving/downloading backups or verifying from the UI. | Added to **P9.14** and **P8.2** (download/verify/delete endpoints are tested). |
| B7 | AI-disabled and no-embedding states were only prose; without an explicit task they would ship as broken buttons. | Added **P9.13** degraded states + **P6.6** tests; all AI CTAs are conditionally rendered from `/meta` capabilities. |
| B8 | Markdown XSS was not an explicit test despite being the main injection surface. | Added **P2.5/P10.1** escape/XSS tests for the renderer; boundary check bans raw HTML injection. |

### Important

| # | Gap | Fix |
| --- | --- | --- |
| I1 | No task for PDF byte-range support; the embedded viewer would fail to seek on large files. | Added to **P3.2** and its test. |
| I2 | No attachment GC or temp-cleanup task, though storage docs require it. | Added **P3.2b** (GC job + boot/tmp cleanup). |
| I3 | No session-prune/trash-purge scheduler test. | Added **P7.3** assertions. |
| I4 | No pre-migration backup test, although startup depends on it. | Added **P0.4** test with a seeded DB and a pending migration. |
| I5 | No `/meta` capabilities consumption in the UI (AI, semantic search, limits). | Added **P9.2/P9.3**. |
| I6 | Trash UI and jobs UI were in Settings prose but not tasks. | Added **P9.14**. |
| I7 | Object favourite/pin and tags management had no UI task. | Added **P9.6/P9.7/P9.14**. |
| I8 | "Ask AI about this" / compare selection actions were not wired to the panel. | Added **P9.13**. |
| I9 | SSE heartbeat and client abort were unspecified in the plan. | Added **P6.4** (15 s heartbeat, abort propagation, partial-persist rule test). |
| I10 | Prompt version/usage metadata not asserted. | Added **P6.3/P6.6**. |
| I11 | No error boundary or request-ID surfacing. | Added **P9.2/P9.3**. |
| I12 | Static asset caching and API no-store headers untested. | Added **P0.6** + **P10.1** header tests. |
| I13 | No plan item for the boundary-check script contents. | Added **P10.2** with explicit rules. |
| I14 | No CI file. | Added optional **P10.8** GitHub Actions (typecheck/test/build). |
| I15 | Note templates existed server-side but no UI selection task. | Added **P9.7**. |
| I16 | Search suggestions endpoint had no UI task. | Added **P9.11** (palette suggestions + recent). |
| I17 | Backup retention and verify UI missing. | Added **P9.14**. |
| I18 | Project archive read-only enforcement needs a test. | Added **P1.2**. |

### Deliberate omissions confirmed (not gaps)

- Bulk actions, undo stack, notifications, OpenAPI generation, object-level restore, calendar, graph, plugins, multi-user. These are documented as deferred in `15`/`16` and must not creep into v1.
- No browser automation in the release gate; a manual checklist in `14` covers it.
- No production build of the server (tsx runs TypeScript); documented in `13`.

## 3. Adjustments to acceptance criteria

- **Phase 0 exit** now includes: static placeholder SPA served from Fastify, `/api` fallback excluded, setup→login→logout cycle in a browser, `/readyz` green.
- **Phase 2 exit** now includes: a note survives a full page reload after typing (debounced save), and a stale tab cannot overwrite a newer version.
- **Phase 6 exit** now includes: with AI disabled, `/meta` reports it and no AI control is clickable.
- **Phase 8 exit** now includes: restore forces re-login and the pre-restore backup is downloadable.
- **Phase 9 exit** now includes: 375 px layout, keyboard-only pass, no FOUC, accent contrast warning.
- **Phase 10 exit** now includes: backup/restore drill performed manually on a copied data directory.

## 4. Plan changes applied

`PLAN.md` was updated with: P0.1a, P0.10, P0.11 (dev seed, optional), P2.5, P3.2b, P6.4 additions, P7.3 assertions, P9.2/P9.3 additions, P9.14 additions, P10.1/P10.2/P10.8, and the revised exit criteria above. No phase was reordered.

## 5. Sign-off

The plan is executable end-to-end with the current toolchain. The riskiest item is Phase 9 (UI breadth), which is why the shell and theme scaffolding moved into Phase 0 and server routes exist before the UI phase starts.
