# Loom — a personal research OS

Loom is a self-hosted web application for research: projects, a Kanban board, block notes with backlinks, a literature database with PDFs and BibTeX, experiments, research questions, an inbox, an append-only activity log, a daily journal, hybrid search and a cited AI assistant.

It is a modular monolith: one Node process, one SQLite database, one data directory, no external services required. AI is optional; the notebook works fully without it.

**Docs:** [`design_docs/`](design_docs/README.md) · [`PLAN.md`](PLAN.md) · [`conversation.md`](conversation.md)

---

## Quick start

Requirements: Node.js 22+ (24 recommended) on Linux/macOS/Windows, ~300 MB disk plus your files. Optional for AI page-image/OCR modes: `poppler-utils` (`pdftoppm`) and `tesseract-ocr`; the Docker image includes both.

```bash
npm ci
npm run dev          # API on :8787, Vite interface on :5173
```

Open <http://localhost:5173>, create the single admin account, and start working.

Production (one process serving API + built interface):

```bash
npm run build
npm start            # http://localhost:8787
```

Data lives in `./data` by default: `loom.db`, content-addressed attachments, backups and the master key. Set `LOOM_DATA_DIR` to move it. Copy the whole directory to move the instance.

### First steps

1. Complete setup (username, password, timezone).
2. Create a project.
3. Press `N` for a note, `T` for a task, `Ctrl/⌘+Shift+Space` for quick capture.
4. Drop a PDF into Literature → *Add reference → PDF upload*.
5. Open Settings → **AI & search** to add an OpenAI-compatible endpoint (Ollama works via `/v1`) or the offline demo provider.

---

## Features

| Area | What you get |
| --- | --- |
| Projects | Independent workspaces, colour dots, archive/read-only, per-project boards |
| Tasks | Configurable columns, drag-and-drop + keyboard moves, priorities, due dates, checklists |
| Notes | Block editor, Markdown shortcuts, wikilinks, backlinks, versions, conflict-safe autosave, local draft recovery |
| Literature | Drag-and-drop queues, bulk metadata re-extraction, AI-filled metadata, separate AI summaries and personal notes, a dedicated reading tab with dockable notes/bookmarks/summary/chat panels and saved PDF annotations, PDF/URL/BibTeX import, reading queue, DOI/Crossref enrichment |
| Experiments | Objective/hypothesis/method, environment key-values, metrics, results, datasets and CSV previews |
| Questions | Open → investigating → answered, answer notes linked automatically |
| Inbox | Global capture, triage into any object type, archive |
| Activity | Append-only event log, per-object history, deterministic daily diff |
| Journal | Deterministic diff first; optional AI interpretation; next steps → tasks |
| Search | FTS5 over objects and chunks (including PDF text), filters, snippets; optional embeddings + RRF hybrid |
| AI | Cited chat over notes/papers (global, project or explicit selection), streaming, save-as-note, extract-tasks, offline fake provider |
| Data | Markdown/BibTeX/JSONL/attachment exports, verified backups, transactional restore, trash |
| Theming | Six palettes × light/dark/system, accent override, density, pre-paint theme (no flash) |

---

## AI configuration

Any endpoint implementing the OpenAI REST shape works:

| Provider | Base URL | Notes |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | API key required |
| Ollama | `http://127.0.0.1:11434/v1` | Key can be empty; set chat and embedding models (e.g. `llama3.1:8b`, `nomic-embed-text`) |
| LM Studio / vLLM / OpenRouter | their `/v1` URL | OpenAI-compatible |
| Offline demo | — | Deterministic, no network, useful for evaluating the UI |

Chat and embeddings are independent. Embeddings are needed for semantic search and improve retrieval, but text search and the whole notebook work without them. API keys are encrypted with AES-256-GCM using `LOOM_SECRET` (or `data/master.key`) and never returned by the API.

Answers are instructed to cite `[n]` sources; citations are validated against the retrieved set and link back to the exact note block or PDF page. When no source supports an answer, the assistant is told to say so.

AI is also used for **literature ingestion**: drop one or more PDFs or links and Loom extracts the source, asks the model for a strict JSON metadata object (title, authors, year, venue, DOI, abstract, type), validates it, and pre-fills the reference. Only the selected representation is sent:

- **OCR then text** (default): local Tesseract when installed, otherwise vision-model transcription, then metadata extraction.
- **Page images**: the first three pages as JPEGs to a vision-capable model.
- **Text extraction**: the PDF's embedded text (fastest and fully local).

The mode is configurable in Settings → AI & search and overridable per PDF submission. Reference pages have **Redo metadata**, which re-runs extraction and prints the prompt sent, the raw metadata completion and the parsed fields before you apply anything. The extractor asks for one strict JSON object, retries with shorter inputs when a provider returns nothing, and accepts common key variants (`Title`, `DOI`, `Year`, `Journal`/`Publication`) plus fenced or prose-wrapped JSON. Literature uses checkbox selection and select-all for **bulk re-extraction**; each item can choose its own mode, results go into a processing list, and validated metadata is applied automatically. The processing list is backed by durable server jobs, so it survives refreshes and keeps working with the tab closed; dropped PDFs waiting to upload are persisted in IndexedDB and resume after a refresh. Reference pages keep **personal notes**, **AI summaries**, links and attachments separate; summaries are queued jobs that can be regenerated with extra instructions. **Read mode** opens in a new tab as a dockable workspace: the PDF stays central, personal notes (Markdown, 30-second autosave) sit alongside it, and bookmarks (page + ≤250-char note), AI summary and AI chat are collapsible panels that can be moved, resized or closed. The built-in PDF viewer supports highlight, ink and sticky-note annotations, persisted automatically to the server. Chat is pinned to the open paper. Without a provider, deterministic extraction (filename, DOI, page metadata) still works.

URL capture also stores an **HTML archive + extracted text** attachment, indexes the text for search, and supports batches of up to ten links.

---

## Data ownership

- **Portal export**: Settings → Data → *Workspace ZIP*, or `GET /api/v1/export/workspace.zip`. Contains a manifest with checksums, JSONL for every table, Markdown notes, BibTeX, original attachments and a README. No password hashes, no API keys.
- **Backup**: Settings → Data → *Create backup*, daily automatic backups, `npm run backup`. A ZIP with a consistent SQLite snapshot, every referenced attachment, manifest and `checksums.sha256`.
- **Restore**: validates format, checksums, schema version and blob presence *before* touching data; creates a pre-restore backup; imports in one transaction; then forces re-login.
- Verify with `sha256sum -c checksums.sha256`; the database is a normal SQLite file you can open anywhere.

Backups contain your entire corpus. Store them encrypted offsite (`restic`, `age`, encrypted disk).

---

## Security

- First-run setup creates the only account; no open registration.
- scrypt password hashing; server-side sessions in HttpOnly SameSite=Lax cookies; 30-day sliding expiry.
- CSRF double-submit token on every unsafe request plus Origin checks.
- Login rate limiting; generic auth errors; timing equalisation.
- CSP, nosniff, frame-ancestors self, no third-party scripts/fonts/telemetry.
- Upload magic-byte sniffing, size caps, content-addressed storage, no path traversal.
- SSRF-guarded URL capture (private/loopback/mapped IPv6, redirect revalidation, size/time caps).
- AI keys encrypted at rest and masked; logs redact secrets.
- Prompt-injection rules: retrieved text is untrusted and the model has no tools.

For HTTPS, run behind a reverse proxy and set `LOOM_SECURE_COOKIES=true`, `LOOM_TRUST_PROXY=true`. Keep `HOST=127.0.0.1` unless the proxy is on the same host.

Writes are protected against CSRF by validating the `Origin` header and a per-session token. The origin must match the request `Host` (or `X-Forwarded-Host` when `LOOM_TRUST_PROXY=true`). If the browser URL differs from what the server sees — a reverse proxy that rewrites `Host`, an alternate port, or a hostname such as `http://loom.lan:8787` — add that exact URL to `LOOM_ALLOWED_ORIGIN` (comma-separated). Requests without an `Origin` header (curl, scripts) still need the CSRF token. A 403 with `csrf_invalid` on login means the origin was rejected.

---

## Configuration

Copy `.env.example` to `.env`. Important variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Listen address |
| `LOOM_DATA_DIR` | `./data` | Database, attachments, backups, master key |
| `LOOM_SECRET` | generated file | Master key material for encrypting AI keys |
| `LOOM_SECURE_COOKIES` | `false` | Set when served over HTTPS |
| `LOOM_TRUST_PROXY` | `false` | Trust `X-Forwarded-*` |
| `LOOM_ALLOWED_ORIGIN` | dev URL only | Extra origins allowed to send writes (comma-separated), e.g. `https://loom.example.com` |
| `LOOM_MAX_UPLOAD_MB` | `50` | Per-file cap |
| `LOOM_MAX_STORAGE_GB` | `10` | Attachment quota |
| `LOOM_LOG_LEVEL` | `info` | Pino level |
| `LOOM_WORKER_ENABLED` | `true` | Background jobs |

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | API + Vite with HMR |
| `npm run build` | Build the SPA into `dist/web` |
| `npm start` | Production server |
| `npm test` | Vitest suite (unit + integration, no network) |
| `npm run test:coverage` | Same suite with a server coverage summary |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check:boundaries` | Enforce module boundaries |
| `npm run seed` | Create a demo project (after setup) |
| `npm run backup` | Create a manual backup from the CLI |
| `npm run migrate` | Apply migrations only |
| `npm run reset-password -- <username>` | Reset a password, sign out all sessions |

Deployment examples: [`Dockerfile`](Dockerfile), [`docker-compose.yml`](docker-compose.yml), and `design_docs/13-ops-observability.md` (systemd/Caddy).

---

## Architecture at a glance

```
Browser (React SPA)
      │ JSON + SSE, session cookie
      ▼
Fastify ── auth guard ── zod validation ── module services
      │                                        │
      │                          ┌─────────────┼──────────────┐
      ▼                          ▼             ▼              ▼
SQLite (WAL)               atomic writes   activity       jobs table
state · FTS5 · jobs        + jobs          events         + in-process worker
      │
      ▼
data/attachments/<sha256>          data/backups/*.zip
```

- Universal `objects` supertype + typed tables; one id space for notes/tasks/references/experiments/questions.
- Every mutation writes its activity event and follow-up job in the same transaction.
- No Redis/Celery; the database queue is durable and retried with backoff.
- AI is a port with two adapters (OpenAI-compatible, deterministic fake); RAG uses FTS5 + optional vector scan fused with RRF.
- The journal is diff-first: the LLM sees only the deterministic diff, never the database.

See `design_docs/02-architecture.md`, `03-domain-model.md`, `04-data-model.md` and the ADRs.

---

## Limits and deliberate non-goals

Single-user, single-process. SQLite single writer, worker concurrency 1. Brute-force vector search is comfortable to ~50k chunks. No multi-user sharing, real-time collaboration, offline sync, calendar, knowledge-graph view, plugin loader or object-level restore yet — each has a documented trigger in `design_docs/15-roadmap-risks.md`.

If you outgrow SQLite, the repository and `VectorIndex`/`BlobStore`/`JobHandler` seams allow a Postgres + pgvector or S3 deployment without changing the domain model.

---

## Verification

The repository ships with 82 tests covering auth/CSRF, notes and conflict handling, wikilinks/backlinks, tasks and ordering, FTS + chunk search + embeddings, PDF extraction and sniffing, AI streaming/citations, backup/restore, export integrity, timezone/DST and BibTeX.

```bash
npm run typecheck && npm run check:boundaries && npm test && npm run build
```

No test hits the network. The AI tests use the deterministic fake provider.

---

## License / ownership

This is a personal project scaffold. Your research data is yours; the export and backup formats are intentionally boring and documented.
