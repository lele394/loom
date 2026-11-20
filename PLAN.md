# Implementation plan

Executable checklist for Loom v1. Checked items are implemented and verified (2026-11-16, 81 tests). Requirement IDs refer to `design_docs/01-requirements.md`.

**Legend:** `[ ]` todo · `[x]` done · `[~]` partial/deferred (with reason)

---

## Phase 0 — Foundation

- [x] **P0.1 Repository scaffold**
  - `package.json` (type module, scripts: dev, build, start, test, typecheck, check:boundaries, reset-password)
  - `tsconfig.json` strict, `moduleResolution: bundler`, `noEmit`
  - `vite.config.ts` (React plugin, `/api` proxy, build → `dist/web`)
  - `.gitignore`, `.env.example`, `README.md`
  - dependency set installed and lockfile committed
- [x] **P0.1a Dependency baseline**
  - pin major versions (Fastify 5, React 19, Vite, zod, better-sqlite3, vitest)
  - `npm install`, verify `better-sqlite3` loads and FTS5 is available
  - commit the lockfile; record Node ≥ 22 requirement (Node 24 used in development)
- [x] **P0.2 Shared contracts** (`src/shared`)
  - zod schemas for auth, projects, objects, notes, tasks, literature, experiments, questions, inbox, AI, settings, backup
  - API DTO types, block types, templates, constants (limits, palettes, errors)
- [x] **P0.3 Core utilities**
  - ULID generator with type prefixes; clock abstraction
  - `zonedDayRange(date, tz)` + `todayIn(tz)` handling DST
  - error taxonomy (`AppError` + codes)
  - text helpers (slug, excerpt, filename sanitise, token estimate)
  - crypto (scrypt hash/verify, session token hash, AES-GCM encrypt/decrypt, fingerprint)
- [x] **P0.4 Database**
  - connection with WAL/FK/busy_timeout/synchronous
  - migration runner with checksums and transactions
  - `001_init.sql` implementing every table/index in `04-data-model.md`
  - test: migrations apply to an empty DB and are idempotent
  - test: a seeded DB with a pending migration produces a `pre_migration` backup first
- [x] **P0.5 Config and master key** (`config.ts`)
  - env validation, data dirs, master key resolution (env/file/generate)
  - `.env.example` documents every variable in `13`
- [x] **P0.6 HTTP foundation**
  - `buildApp(ctx)` with request IDs, Pino redaction, security headers, rate limit
  - error handler envelope + 404/500 handling
  - static SPA serving + history fallback (never for `/api`)
  - `/healthz`, `/readyz`, `/meta`
  - graceful shutdown + worker requeue
- [x] **P0.7 Authentication** (AUTH-1..6)
  - first-run setup (race-safe), login/logout/logout-all, session endpoint
  - scrypt passwords, session rotation, CSRF cookie + guard, origin check
  - login rate limit, password change
  - CLI `reset-password`
- [x] **P0.8 Test harness**
  - temp data dir, migrations, fake worker, `login()` helper, `runJobs()`
  - auth tests: setup twice, bad password, CSRF, expiry, logout-all
- [x] **P0.10 SPA scaffold**
  - `index.html` with pre-paint theme script, `main.tsx`, placeholder route
  - dev proxy (`/api`), `npm run dev` script (API watch + Vite)
  - Fastify serves `dist/web` with SPA fallback excluding `/api`; cache headers
  - setup → login → logout works in a real browser
- [x] **P0.11 Optional dev seed script** (`scripts/seed.ts`) creating a demo project, notes and tasks against a scratch data dir (never runs in production)

**Exit:** server boots, setup/login works, `/readyz` green, auth tests pass, placeholder SPA is served from the Fastify process.

---

## Phase 1 — Objects, projects, activity

- [x] **P1.1 Object registry**
  - type definitions (labels, icon, route, search body, exporter hooks)
  - `objects` service: create/update/delete/restore, version bump, actor
  - tags: create-by-name, full replacement, counts
  - links: create/remove/backlinks, uniqueness, self-link rejection
- [x] **P1.2 Projects**
  - CRUD, archive/restore, soft delete with object cascade
  - default columns (Backlog/Todo/Doing/Done), reorder, delete guard
  - project overview counts
  - archived projects reject writes (`423`) and are read-only in the UI
- [x] **P1.3 Activity** (ACT-1..4)
  - `record()` inside transactions; title snapshot; summary builders
  - list filters (project/object/type/date), `before` pagination
  - deterministic diff (project grouping, precedence rules)
  - `/dashboard` aggregate
- [x] **P1.4 Routes and tests**
  - projects/objects/tags/links/activity/dashboard
  - tests: event emitted per mutation, delete→trash→restore, link uniqueness

**Exit:** project + generic object lifecycle with a complete activity trail.

---

## Phase 2 — Notes and Kanban

- [x] **P2.1 Note templates** (research, literature, experiment, meeting, daily, technical)
- [x] **P2.2 Notes service** (NOTE-1..5)
  - create from template, save full doc with `expectedVersion`/`force`
  - plain-text derivation, chunks per block, word count
  - wikilink parsing + mention links, warnings for ambiguity/unresolved
  - version snapshots (throttled, retention 50/90d), list/get/restore
  - markdown export with front matter
- [x] **P2.3 Tasks service** (TASK-1..4)
  - create/update, move with dense reorder, complete/reopen via done column
  - project-move column reassignment
  - board query, due filters
- [x] **P2.4 Routes and tests**
  - notes, tasks, board, columns
  - tests: version conflict, force snapshot, wikilinks/backlinks, move semantics, completion events
- [x] **P2.5 Markdown renderer tests**: escape-first rendering, no raw HTML, safe link schemes, wikilink output

**Exit:** writable notebook and board with safe concurrency. A note survives a full reload; a stale tab cannot overwrite a newer version.

---

## Phase 3 — Literature and files

- [x] **P3.1 Blob store** (DATA-1; `11`)
  - streamed put with hash/size cap, dedup, atomic rename, open/stat/remove
  - path layout, permissions, temp cleanup
- [x] **P3.2 Attachments service**
  - multipart upload, MIME sniffing, quotas, attachment rows
  - authenticated download, content-disposition, ETag, PDF inline/range
  - delete + activity; previews for CSV
- [x] **P3.2b Storage maintenance**: boot/hourly temp cleanup, attachment GC job with 24 h grace, quota reporting
- [x] **P3.3 PDF extraction job**
  - unpdf text + page map, DOI regex, status transitions, error handling
  - text storage + reindex trigger
- [x] **P3.4 Literature** (LIT-1..5)
  - CRUD, cite-key generation/uniqueness, reading status/rating
  - URL ingestion with SSRF guard + redirect revalidation + cap
  - BibTeX export (all/project/ids) and import report
- [x] **P3.6 AI-assisted metadata extraction** (extension, 2026-11-16)
  - PDF drag-and-drop and multi-file ingest; PDF tab and URL tab use analyze-and-add
  - `POST /references/ingest-pdf`, AI-enhanced `/references/ingest-url`
  - structured JSON schema, zod validation, DOI normalisation, heuristic fallback when AI is off
  - regeneration of filename-based cite keys after AI authors/year
  - attachment pending-state polling and "AI metadata" provenance badge
  - service test with the offline provider
- [x] **P3.7 Metadata diagnostics, input modes and web archives** (extension, 2026-11-16)
  - per-submission PDF mode override (`text`/`images`/`ocr`) + app default in Settings → AI
  - page rendering via pdftoppm, local Tesseract OCR with vision fallback
  - `POST /references/:id/reextract-metadata` returns raw model output, parsed fields, OCR text and text preview
  - Redo-metadata modal prints raw output and applies only on explicit confirmation
  - batch URL capture (max 10) with per-URL errors and HTML + text archive attachments
  - archive text indexed for search/citations; tests for modes, raw output, archive and multi-link errors
- [x] **P3.8 Bulk metadata, AI summaries and read mode** (extension, 2026-11-16)
  - literature row selection + select-all + per-item bulk extraction mode (OCR default)
  - metadata processing queue with status dots and automatic metadata application
  - personal notes moved to their own panel; separate AI summary artifact and queue job
  - summary regeneration with added instructions and selectable extraction mode
  - bookmarks API (page + 250-char note), migration 003, export/backup coverage
  - dedicated read tab with a dockable panel layout, resizable left/right docks and a panel-spawning topbar
  - Markdown personal-notes editor with 30-second autosave and saved/unsaved/no-connection indicator
  - bookmarks, AI summary and paper-bound AI chat as collapsible, movable and closable dock panels
  - built-in pdf.js reader with selectable text, text/area highlights, ink and sticky-note annotations, Ctrl+Z undo and API persistence (migration 005)
  - per-panel vertical resizing plus whole-title collapse toggles alongside the red drag/move/close affordances
- [x] **P3.9 Durable processing queues** (extension, 2026-11-16)
  - bulk metadata re-extraction moved to `reference.reextract` jobs; migration 004 adds `jobs.dismissed_at`
  - literature queue hydrates from `GET /references/extraction-jobs` and polls until idle, so refresh or a closed tab loses nothing
  - Clear finished dismisses rows from the queue while keeping the job history in Settings → Jobs
  - PDF drop queue persisted in IndexedDB; queued uploads resume after reload, interrupted uploads are marked failed with Retry
  - queue tests cover enqueue → reload view → apply → dismiss
- [x] **P3.10 Structured metadata output** (extension, 2026-11-17)
  - `metadata@2` prompt: explicit JSON contract, bare DOI, OCR-noise guidance, 8k input cap
  - tolerant parsing (fences/prose/arrays/wrappers/trailing commas) and alias keys (`Title`, `DOI`, `Year`, `Journal`, `Publication`)
  - retries with 4k/2.2k text and no JSON mode; higher output budgets for reasoning models
  - OpenAI-compatible provider accepts non-streamed JSON bodies and array content parts
  - raw dialog output is the metadata completion only; OCR text and the prompt are separate sections
- [x] **P3.11 Linked GitHub repositories and commit timelines** (extension, 2026-11-17)
  - per-project repository links (multiple repos supported), public or private with an encrypted read-only token
  - shared account GitHub token in Settings, per-repository token override, scoped-key AES-GCM storage, classic write-scope rejection and fine-grained setup guidance
  - commit metadata import via GitHub REST API (never a clone), deduplicated by SHA, capped at 1,000 recent commits per pull
  - commits timestamped by author date and added to project activity plus the matching daily journal diff
  - `digest@2` prompt includes imported commits; repository data covered by export/backup
  - migration 006, API routes, Code project tab, repository sync test
- [x] **P3.12 Project and global calendars** (extension, 2026-11-17)
  - per-project calendar items with title, type, optional end time and description (migration 008)
  - project colour drives the item body, type drives a red/yellow/blue/purple/green left accent
  - global Calendar destination aggregates every project with a chronological Upcoming bar
  - month grid supports multi-day events, click-to-create, edit/delete, archived-project read-only state
  - calendar activity recorded in the project timeline; export/backup coverage and API tests
- [x] **P3.20 Configurable AI token budgets** (extension, 2026-11-20)
  - app settings add `aiContextTokens` (64k default), `aiChatOutputTokens` (1.2k) and `aiSummaryOutputTokens` (6k)
  - chat sources use the context budget with multiple chunks per object and larger retrieval caps
  - AI actions and literature summaries share the configurable source budget and summary output cap
  - chat output and journal digest output read their budgets from settings
  - Settings exposes the values with validation and persistence tests
- [x] **P3.19 Embedding progress visibility** (extension, 2026-11-20)
  - `/search/status` reports pending/total coverage, percentage and latest embedding job state/error
  - assistant status shows a live progress bar, queued/running/failed labels and retry count
  - backfill refuses clearly without an embedding model, avoids duplicate active jobs and reports when nothing is pending
  - worker batches pending objects with a time budget and queues continuation jobs instead of silently stopping at 200 objects
  - tests cover missing-model refusal, progress completion and the no-op response after full coverage
- [x] **P3.18 Split chat and embedding defaults** (extension, 2026-11-20)
  - migration 012 adds independent `is_chat_default` and `is_embedding_default` provider flags
  - chat, journal/literature AI and embedding search resolve their own default providers
  - Settings shows separate default badges and checkboxes; re-embedding is queued when the embedding default changes
  - legacy single-default providers migrate sensibly, with fallbacks for chat-capable and embedding-capable providers
  - API/status and search test cover a remote chat provider plus local embedding provider
- [x] **P3.17 Journal personal notes** (extension, 2026-11-19)
  - per-user, per-day Markdown notes with autosave and explicit save for untracked work
  - notes are included as bounded context in the `digest@3` AI prompt, never as instructions
  - digest staleness tracks note edits via `source_note_updated_at`; digest-generation events no longer self-mark the digest stale
  - journal note persistence, API/export/backup coverage and tests
- [x] **P3.16 Custom palette designer** (extension, 2026-11-18)
  - colour-wheel input plus monochrome, duo-tone and tri-tone derivations
  - analogous, complementary, split-complementary, triad, square, compound, shades and monochrome harmonies
  - five editable scheme swatches with regeneration from the base tone(s)
  - custom palettes derive app surfaces, text, borders, accent, info and reader tokens while keeping semantic colours
  - all five scheme colours contribute to the theme; persisted through the appearance API with validation and tests
- [x] **P3.15 Reading comfort controls** (extension, 2026-11-17)
  - persistent personal-note text scaling in read mode (75–300%) for editor and Markdown preview
  - PDF appearance cog panel with night/invert, default, warm and contrast presets
  - brightness, contrast and warmth sliders applied to the page canvas while annotations stay readable
  - the same custom pdf.js viewer now replaces the reference-page iframe; appearance is a shared global store with live same-window and cross-tab synchronisation
- [x] **P3.14 Protected Personal project** (extension, 2026-11-17)
  - migration 010 adds `projects.is_system`, unique system flag and the built-in Personal project with board columns
  - Personal is always listed first and restored automatically if missing, archived or deleted
  - rename, archive, delete and purge are refused in the API; project settings hide destructive controls
  - works with every object type, calendars and external feeds; covered by a protection/use test
- [x] **P3.13 External calendar sync** (extension, 2026-11-17)
  - per-project `.ics` subscriptions with SSRF-safe fetching and 5 MB feed cap
  - iCalendar parsing with timezones, recurrence expansion, cancelled-event filtering and type mapping
  - deduplicated external items; removed source events clean up within the sync window
  - manual Resync plus automatic refresh on calendar open when older than 30 minutes
  - green success / yellow syncing / red failed status dots, migration 009, parser and sync tests
- [x] **P3.5 Routes, UI hooks, tests**
  - upload limits/sniff rejection, dedup, DOI not overwritten, SSRF cases, BibTeX round-trip, range requests

**Exit:** upload a paper, get extracted text, search it, export BibTeX.

---

## Phase 4 — Experiments, questions, inbox, trash

- [x] **P4.1 Experiments** (EXP-1..4): CRUD, environment/metrics parsing, status, CSV preview
- [x] **P4.2 Questions** (QUEST-1..2): CRUD, answer creates/links note
- [x] **P4.3 Inbox** (INBOX-1..3): capture, list, convert to each type, archive, delete
- [x] **P4.4 Trash**: list/restore/purge, purge cascade + FTS cleanup
- [x] **P4.5 Tests** for conversions, answer linking, purge keeps events

**Exit:** every object type can be created, linked and recovered.

---

## Phase 5 — Search

- [x] **P5.1 Indexer** (SRCH-1): FTS upsert/delete, chunks per type, transactional
- [x] **P5.2 Query** (SRCH-2): sanitised FTS, BM25 weights, snippet, filters, suggest
- [x] **P5.3 Semantic/hybrid** (SRCH-4..5): embedding job, vector scan, RRF, optional rerank, status
- [x] **P5.4 Reindex/coverage** endpoints + tests (filters, syntax injection, deleted objects, hybrid)

**Exit:** fast cross-type search; semantic works with fake/real embeddings.

---

## Phase 6 — AI

- [x] **P6.1 Providers** (AI-7): port, OpenAI-compatible adapter, fake adapter, error normalisation, health
- [x] **P6.2 Configuration** (AI-8): provider CRUD, encrypted keys, masked responses, test endpoint
- [x] **P6.3 RAG** (AI-3..5): context builder, budget, prompt assembly (versioned), citation validation, usage metadata
- [x] **P6.4 Chat** (AI-2): conversations/messages CRUD, SSE stream (user/meta/delta/citations/usage/done/error), 15 s heartbeat, abort propagation, completion-only persistence
- [x] **P6.5 Actions** (AI-6): summarize, compare, related, message→note, message→tasks with schema validation
- [x] **P6.6 Tests**: SSE order, heartbeat parse, citation stripping, selection scope, disabled mode (503), provider failure, save/extract, prompt version recorded

**Exit:** a grounded, cited conversation over notes and PDFs; fully usable when disabled; no AI control is active without capabilities.

---

## Phase 7 — Journal and scheduling

- [x] **P7.1 Diff golden cases** (ACT-4..5): empty, multi-project, timezone edge, create+update, delete
- [x] **P7.2 Digest** (ACT-6..7): deterministic diff + AI prompt, revisions, staleness, idempotent job
- [x] **P7.3 Scheduler** (08 §3): daily digest, daily backup, session prune, trash purge, catch-up; idempotent keys tested
- [x] **P7.4 Routes/tests**: journal get/generate/revisions, digest with AI off, regeneration archive, staleness flag

**Exit:** daily journal works with and without AI, never invents events.

---

## Phase 8 — Export, backup, restore

- [x] **P8.1 Exports** (DATA-1..2): note markdown, BibTeX, project ZIP, workspace ZIP, manifest, checksums, README
- [x] **P8.2 Backup** (DATA-3..4): snapshot, integrity check, zip, verify, list/download/delete, retention, pre-migration/pre-restore
- [x] **P8.3 Restore** (DATA-5..6): upload streaming, zip safety, checksum/manifest/schema/blob validation, pre-restore backup, transactional import, session invalidation + `reloginRequired`, reindex, maintenance flag
- [x] **P8.4 Tests**: verify, tamper, missing blob, rollback, retention, round-trip counts/blobs, relogin after restore

**Exit:** a backup restores into a clean instance with identical data, forces re-login, and the pre-restore backup is downloadable.

---

## Phase 9 — Frontend

- [x] **P9.1 Theme system** (UI-2..4): tokens, 6 palettes × light/dark, system mode, pre-paint script, accent derivation + contrast guard, density
- [x] **P9.2 API client + primitives** (UI-6): fetch with CSRF/error mapping, SSE parser, `/meta` capabilities, toast, modal, confirm, field, table, empty/loading/error, error boundary with request ID
- [x] **P9.3 Shell**: rail with projects, topbar search, AI dock, mobile drawer, route guards, 401 → login with return path, setup-required redirect
- [x] **P9.4 Auth pages**: setup + login (validation, errors, first-run redirect)
- [x] **P9.5 Dashboard**: greeting, stats, projects, due tasks, inbox, yesterday digest, recent activity, capabilities banner
- [x] **P9.6 Projects/board**: project CRUD/archive, overview, favourites, tags, Kanban with DnD + keyboard move, quick add
- [x] **P9.7 Notes**: list/filters/templates, editor (block types, markdown shortcuts, autosave, conflict dialog, localStorage draft + recovery banner), versions, links/backlinks, AI actions, export
- [x] **P9.8 Literature**: table/filters, add dialog (PDF/URL/manual/BibTeX), detail (metadata, PDF iframe, attachments, reading status, AI), export
- [x] **P9.9 Experiments/questions**: list/detail forms, metrics/env editors, CSV preview, answer flow
- [x] **P9.10 Inbox + quick capture**: global hotkey modal, triage to object type
- [x] **P9.11 Search + command palette**: results, filters, suggestions/recent, actions, keyboard nav
- [x] **P9.12 Journal + activity**: date navigation, diff, summary, regenerate, next-steps→tasks, timeline
- [x] **P9.13 AI panel**: scope, context chips, streaming, citations, history, save/extract, ask-about-object, compare selection, degraded states (no provider/no embeddings), usage display
- [x] **P9.14 Settings**: appearance, AI providers/test, data/export, backup create/list/verify/download/restore (typed confirm + relogin), jobs, trash, tags, account, about
- [x] **P9.15 Responsive/a11y**: focus traps, aria-live, reduced motion, 375/1440 layouts, shortcut help, contrast warning

**Exit:** every P0/P1 flow is operable in the browser, including restore and the no-AI states.

---

## Phase 10 — Hardening and release

- [~] **P10.1** Full suite green (81 tests); security-header, cache-header and markdown-XSS tests added. Measured server line coverage: 64.3% overall, auth 74.0%, activity 81.3%, backup 80.9% — the ≥85% target for auth/backup is deferred to v1.1.
- [x] **P10.2** `check:boundaries` passes: no module repo cross-imports, no feature-component cross-imports, no `dangerouslySetInnerHTML`, no `console.*` in server
- [x] **P10.3** `typecheck` + production `build` green
- [x] **P10.4** Manual smoke + restore drill on a copied data dir: setup → project → note → task → PDF → search → AI (fake) → digest → export → backup → restore → re-login
- [x] **P10.5** README quick start, data layout, deployment, security notes, screenshots-free
- [x] **P10.6** Reconcile docs with implementation; update `REVIEW.md` if a decision changed
- [~] **P10.7** Optional: git was not initialised; the workspace was pre-existing and not a repository.
- [x] **P10.8** Optional CI workflow (typecheck, boundaries, tests, build) for GitHub Actions

---

## Cross-cutting definition of done

Each feature must: validate input, authorize, write an activity event, update search/chunks, appear in export, handle loading/empty/error in UI, and have tests. No feature ships with a TODO in a critical path.

## Dependency order

`core → db → auth → objects/projects → notes/tasks → files/literature → search → ai → journal → backup → frontend`.

Frontend work can begin after Phase 1 routes exist; it must not block server phases.
