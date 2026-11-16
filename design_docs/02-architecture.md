# 02 — System architecture

## 1. Style: modular monolith

One Node.js process serves the JSON API, the built SPA and background jobs. One SQLite database is the system of record. One data directory holds the database, attachments, backups and logs.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Browser (React SPA)                                                  │
│  routes · feature modules · design tokens · fetch/SSE client         │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTPS (JSON + SSE), session cookie
┌───────────────────────────────▼──────────────────────────────────────┐
│ Loom server (Fastify)                                                │
│                                                                      │
│  http/            routes, auth guard, CSRF, validation, errors       │
│  modules/         domain services (one folder per bounded concern)   │
│  core/            registry, events, jobs, authz, errors, ids, clock  │
│  storage/         BlobStore port → local content-addressed FS        │
│  ai/              Provider port → OpenAI-compatible / fake           │
│  db/              connection, migrations, repositories              │
│  worker/          in-process job runner + scheduler                  │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │                               │
        ┌───────▼────────┐              ┌───────▼──────────────┐
        │ SQLite (WAL)   │              │ data/attachments/    │
        │ state + FTS5   │              │ sha256 blobs         │
        │ events + jobs  │              └──────────────────────┘
        └────────────────┘
                │
        ┌───────▼──────────────────────────────────────────────┐
        │ data/backups/  (zip: db snapshot + blobs + manifest)│
        └─────────────────────────────────────────────────────┘
```

**Why not the source design's Postgres + Redis + Celery + FastAPI stack?** For a single-user notebook it triples operational surface (services, migrations in two languages, worker deployment) without adding user value. The source design's *capabilities* are preserved; its *distributed parts* are replaced by local equivalents behind the same interfaces. See `adr/0002-sqlite-instead-of-postgres.md` and `16-gap-analysis.md §4`.

## 2. Runtime components

| Component | Responsibility | Implementation |
| --- | --- | --- |
| HTTP API | Transport, validation, authn/z, serialization | Fastify 5 + zod |
| SPA host | Serve static build, SPA fallback | `@fastify/static` |
| Domain services | Business rules, transactions, activity events | Plain TS classes/functions per module |
| Repositories | SQL, row↔domain mapping | Hand-written SQL inside module services; `repo.ts` is the extraction seam when a module grows |
| Event log | Append-only activity records | `activity_events` table |
| Job queue | Durable background work | `jobs` table + in-process worker |
| Scheduler | Cron-like periodic enqueue | 60 s tick, DB-backed idempotency keys |
| Search index | FTS5 documents + chunks | SQLite FTS5 + `chunks` table |
| AI gateway | Chat/embedding/rerank providers | Ports + adapters |
| Blob store | Binary storage, dedup, GC | Local FS, `sha256` paths |
| Backup service | Snapshot, archive, verify, restore | better-sqlite3 backup + zip |
| Exporter | Portable formats | JSONL/Markdown/BibTeX/ZIP |

## 3. Backend module catalog

Each module is a folder under `src/server/modules/<name>/` with `service.ts` (public interface) and optional `repo.ts`, `routes.ts`, `types.ts`. Public interfaces are consumed through the composition root (`ctx`), never by importing another module's `repo.ts`.

| Module | Owns | Public surface | Depends on |
| --- | --- | --- | --- |
| `auth` | users, sessions, passwords, CSRF | `setup`, `login`, `logout`, `authenticate`, `requireUser` | core, db |
| `projects` | projects, board columns, membership rows | CRUD, archive, board config | core, objects |
| `objects` | `objects` supertable, tags, links, universal queries | `create`, `update`, `remove`, `get`, `link`, `backlinks`, `attachTags` | core, db |
| `notes` | note docs, blocks, versions, wikilink parsing | CRUD, `saveDoc`, `restoreVersion`, `exportMarkdown` | objects, links, search, events |
| `tasks` | tasks, order ranks, completion | CRUD, `move`, `complete`, `dueSoon` | objects, links, events |
| `literature` | references, BibTeX, URL ingestion, PDF upload | CRUD, `ingestUrl`, `uploadPdf`, `importBibtex`, `exportBibtex` | objects, storage, jobs, ai |
| `experiments` | experiment records, metrics | CRUD | objects, storage |
| `questions` | research questions | CRUD, `answer` | objects, notes |
| `inbox` | capture items, triage | `capture`, `convert`, `archive` | objects, tasks, notes, literature, experiments, questions |
| `activity` | event queries, diffs, digest orchestration | `record`, `list`, `diff`, `generateDigest` | db, ai, jobs |
| `search` | FTS documents, chunks, hybrid retrieval | `indexObject`, `removeObject`, `search`, `retrieve` | db, ai |
| `ai` | providers, conversations, messages, RAG, prompts | `status`, `chatStream`, `embedObject`, `summarize` | search, objects |
| `attachments` | upload/download, text extraction, previews | `upload`, `download`, `remove`, `extractText` | storage, jobs |
| `export` | portable exports | `noteMarkdown`, `bibtex`, `projectZip`, `workspaceZip` | all read-only |
| `backup` | snapshot/verify/restore/prune | `create`, `list`, `verify`, `restore`, `prune` | db, storage |
| `settings` | app/user settings, AI config, encrypted secrets | `get`, `update`, `aiConfig`, `publicAiConfig` | core, db |
| `health` | readiness/liveness | `check` | db, storage, worker |

**Dependency rules**

1. `http` may import module services and schemas; it must not contain business rules.
2. Modules may import `core`, `db`, `storage`, `ai` ports and *other modules' public service interfaces*.
3. A module must not import another module's `repo.ts` or SQL.
6. Route handlers contain no writes and no business rules. A few read-only dashboard aggregates compose SQL in `http/routes/meta.ts`; move them into a service if they grow beyond simple counts.
4. Cross-module side effects go through the in-process event bus (`core/events.ts`) or jobs, never through implicit coupling.
5. Every mutation is executed inside one DB transaction that also writes its activity event and enqueues its follow-up jobs. There is no outbox table because the queue lives in the same database (see ADR 0005).

## 4. Request lifecycle

```
request
  → request-id + structured log
  → security headers
  → rate limit
  → session cookie → auth guard (skips /auth/*, /healthz, static)
  → CSRF check for unsafe methods
  → zod validation (body/query/params)
  → module service (transaction)
       ├─ write state
       ├─ append activity event
       ├─ enqueue jobs (index, embed, backup…)
       └─ emit in-process domain event (optional listeners)
  → serialization (snake_case? no — camelCase JSON)
  → response
```

Errors are thrown as `AppError` subclasses and rendered by one error handler:

```json
{ "error": { "code": "note_version_conflict", "message": "Note was modified elsewhere.", "details": { "currentVersion": 7 }, "requestId": "req_…" } }
```

## 5. Concurrency model

- SQLite in WAL mode, `busy_timeout=5000`, `synchronous=NORMAL`, foreign keys ON.
- All writes are short transactions. Long work (PDF parsing, embeddings, LLM calls, zipping) happens outside transactions.
- The worker runs in the same process but on the event loop; CPU-heavy work (PDF extraction, zip creation) uses `worker_threads` only if profiling shows blocking. PDF extraction is async and chunked by `unpdf`; acceptable in v1.
- Optimistic concurrency: `objects.version` increments on every write. Clients may send `expectedVersion`; mismatch → `409 note_version_conflict`. Note saves are the primary user of this.
- The API is stateless apart from sessions; SSE streams hold no DB transaction while open.

## 6. Frontend architecture

Feature-sliced, no global state library:

```
src/web/
  app/            router, providers, shell (rail, topbar, AI dock)
  shared/
    api.ts        typed fetch wrapper + SSE
    ui/           Button, Card, Badge, Modal, Field, Tabs, Empty, Toast…
    markdown.ts   safe markdown renderer (escape-first)
    hooks/        useAsync, useDebounced, useHotkeys, useTheme
    theme/        palettes, token application, no-FOUC bootstrap
  features/
    auth/ projects/ tasks/ notes/ literature/ experiments/
    questions/ inbox/ activity/ journal/ search/ ai/ settings/ backup/
```

Rules:
- Server data is fetched through `api.ts`; a tiny `useResource` hook provides loading/error/refresh. No caching library in v1 (few screens, cheap queries).
- UI state stays local to features. Cross-feature state is limited to: current project, theme, toasts, AI context selection. These live in three small React contexts.
- Routes are lazy-loaded per feature to keep the initial bundle small.
- Every feature exports routes and a command-registry contribution.

## 7. Extensibility seams

| Seam | Interface | What a future change costs |
| --- | --- | --- |
| Object types | `ObjectTypeDefinition` registry (`type`, table, labels, search body, route, exporter, event formatter) | Add a new research object without touching search/links/export/activity |
| Database | Repositories + thin `Db` wrapper; SQL confined to repos | Swap SQLite→Postgres by rewriting repos + FTS/vector adapters |
| Vectors | `VectorIndex` port (brute-force now) | Add sqlite-vec/pgvector/Qdrant |
| Blobs | `BlobStore` port | Add S3/NAS backend |
| AI | `AiProvider` port with capability flags | Add Anthropic, local llama.cpp, rerankers |
| Jobs | `JobHandler` registry keyed by type | Move to external worker without changing producers |
| Auth | `AuthStrategy` boundary; local sessions now | Add OIDC/passkeys |
| UI themes | Design tokens + palette objects | Add themes without component edits |
| Commands | Command registry (id, title, run, shortcut) | Plugins can contribute commands |
| Widgets | Dashboard widget registry | Configurable dashboards/plugins |
| Export | Per-object exporters registered by type | Add formats without core changes |

We deliberately **do not** build a dynamic plugin loader in v1. Extension points are in-process registries; a plugin system needs a sandboxing and versioning design that would delay the product (see `15-roadmap-risks.md`).

## 8. Deployment topologies

**Local (default).** `npm run build && npm start`. Opens on `http://localhost:8787`. Data in `./data` (configurable). TLS optional on loopback.

**Home server.** systemd unit or Docker Compose; reverse proxy (Caddy/Nginx) terminates TLS; `LOOM_TRUST_PROXY=1`, `LOOM_SECURE_COOKIES=1`; bind to `127.0.0.1` behind proxy. Daily backups to another disk via `LOOM_BACKUP_DIR`.

**Not supported in v1.** Horizontal scaling (SQLite single writer), serverless deployment (filesystem + long-lived SSE), multi-tenant hosting.

## 9. Directory layout

```
central_research_notes/
├── conversation.md
├── design_docs/                  # this specification
├── PLAN.md
├── data/                         # runtime, gitignored
│   ├── loom.db
│   ├── attachments/ab/cd/<sha256>
│   ├── backups/
│   └── tmp/
├── scripts/dev.mjs               # runs API + Vite together
├── src/
│   ├── server/
│   │   ├── main.ts  app.ts  config.ts  ctx.ts
│   │   ├── core/    db/  storage/  ai/  worker/
│   │   ├── http/    (auth guard, errors, routes)
│   │   └── modules/ (one folder per module)
│   ├── web/
│   └── shared/                   # types + pure helpers used by both
├── tests/
└── vite.config.ts
```

## 10. Technology decisions (summary)

| Concern | Choice | ADR |
| --- | --- | --- |
| Language | TypeScript end-to-end, Node 24 | 0001 |
| Database | SQLite (WAL) + FTS5 | 0002 |
| Backend | Fastify 5 | 0003 |
| ORM | none; hand-written SQL + zod | 0003 |
| Frontend | React 19 + Vite + CSS tokens (no Tailwind dependency) | 0009 |
| Jobs | SQLite-backed queue, in-process worker | 0005 |
| AI | OpenAI-compatible + fake adapters | 0006 |
| Auth | Local sessions, scrypt, CSRF double-submit | 0007 |
| Notes | JSON block doc + snapshots, optimistic versioning | 0008 |
| Backup | SQLite snapshot + zip + checksums | 0010 |
| Search | FTS5 BM25 + optional vectors, RRF fusion | 0011 |
| Testing | Vitest + Fastify inject + fake AI | 0012 |
