# 01 — Requirements and user stories

Every requirement has an ID used by `PLAN.md` and the test suite. Priority: **P0** (v1 must), **P1** (v1 should), **P2** (deferred), **P3** (someday).

---

## 1. Functional requirements by module

### AUTH — identity and access

| ID | Requirement | Priority |
| --- | --- | --- |
| AUTH-1 | First run shows a setup screen that creates the single admin account (username, password, timezone); setup is impossible once an account exists. | P0 |
| AUTH-2 | Login with username/password; generic failure message; rate limited. | P0 |
| AUTH-3 | Sessions are server-side, survive restart, expire after 30 days of inactivity, and are revocable (logout, logout-all). | P0 |
| AUTH-4 | All state-changing requests require a CSRF token; cross-origin writes are rejected. | P0 |
| AUTH-5 | Password change requires the current password; minimum length 10. | P0 |
| AUTH-6 | Session cookie is HttpOnly, SameSite=Lax, Secure when served over HTTPS. | P0 |
| AUTH-7 | Auth can later be delegated to OIDC without changing local authorization checks. | P2 |

### PROJ — projects

| ID | Requirement | Priority |
| --- | --- | --- |
| PROJ-1 | Create, rename, describe, colour-tag, archive and delete projects. | P0 |
| PROJ-2 | Projects are containers, not databases: every object has at most one project and can be moved. | P0 |
| PROJ-3 | Cross-project views (dashboard, search, activity) aggregate without duplication. | P0 |
| PROJ-4 | Deleting a project requires confirmation and soft-deletes its objects into trash; it does not cascade-erase silently. | P0 |
| PROJ-5 | Project overview shows counts, recent activity, open questions and today's tasks. | P1 |

### TASK — Kanban and tasks

| ID | Requirement | Priority |
| --- | --- | --- |
| TASK-1 | Each project has configurable ordered columns (default: Backlog, Todo, Doing, Done) with a done column. | P0 |
| TASK-2 | Tasks have title, description, priority (low/med/high/urgent), due date, start date, checklist, estimate, tags and links. | P0 |
| TASK-3 | Drag-and-drop within/between columns persists order; keyboard alternative exists. | P0 |
| TASK-4 | Completing a task sets `completed_at` and logs `task.completed`; reopening clears it. | P0 |
| TASK-5 | Overdue and due-soon tasks are surfaced on the dashboard. | P0 |
| TASK-6 | WIP limits are display-only warnings in v1. | P2 |
| TASK-7 | Milestones and a calendar view. | P2 |

### NOTE — notes

| ID | Requirement | Priority |
| --- | --- | --- |
| NOTE-1 | Notes are ordered lists of typed blocks, each with a stable ID. | P0 |
| NOTE-2 | Block types: paragraph, H1–H3, bullet, numbered, todo, quote, code, callout, divider, equation (stored LaTeX), reference embed, task embed. | P0 |
| NOTE-3 | Autosave with debounce; concurrent edits are detected via document version and surfaced, never silently overwritten. | P0 |
| NOTE-4 | Wikilinks `[[Title]]` create typed mention links and backlinks. | P0 |
| NOTE-5 | Version snapshots are retained (last 50 or 90 days, whichever is smaller) and restorable. | P1 |
| NOTE-6 | Templates (research, literature, experiment log, meeting, daily, technical) pre-populate blocks. | P0 |
| NOTE-7 | Markdown rendering and copy/export as Markdown with front matter. | P0 |
| NOTE-8 | Notes can be pinned, favourited and filtered by template/tag. | P1 |
| NOTE-9 | Rich tables, images inline, and LaTeX rendering (KaTeX). | P2 |
| NOTE-10 | Real-time collaborative editing. | P3 |

### LIT — literature

| ID | Requirement | Priority |
| --- | --- | --- |
| LIT-1 | References carry title, authors, year, venue, DOI, URL, type, abstract, tags, reading status, rating, notes. | P0 |
| LIT-2 | Add by manual form, by one or more URLs (fetch page + local archive), or by PDF upload/drag-and-drop; extract text/images/OCR, detect DOI, and ask the configured AI for validated structured metadata (title, authors, year, venue, abstract, type), with deterministic fallback and a per-submission mode override. | P0 |
| LIT-9 | Capture multiple links in one batch; archive each page as HTML plus searchable text. | P1 |
| LIT-3 | A reference belongs to one collection project but can be linked to objects in other projects (cross-project links). | P0 |
| LIT-4 | PDFs and supplementary files are stored as attachments; text is extracted in the background with visible status. | P0 |
| LIT-5 | Import/export BibTeX; export bibliography for a project or selection. | P0 |
| LIT-6 | Reading queue statuses: unread, reading, reviewed, archived. | P1 |
| LIT-7 | DOI/metadata providers (Crossref) enrich records on demand. | P1 |
| LIT-8 | RIS import/export and citation formatting styles. | P2 |

### EXP — experiments

| ID | Requirement | Priority |
| --- | --- | --- |
| EXP-1 | Experiments record objective, hypothesis, method, environment (key/value), results (markdown), status and dates. | P0 |
| EXP-2 | Attach datasets, plots, logs; CSV attachments get a preview table. | P0 |
| EXP-3 | Link experiments to references, notes and questions. | P0 |
| EXP-4 | Experiments are first-class objects: searchable, taggable, exportable. | P0 |
| EXP-5 | Numeric metrics can be recorded as named values and compared later. | P1 |
| EXP-6 | Inline charting of CSV data. | P2 |

### QUEST — research questions

| ID | Requirement | Priority |
| --- | --- | --- |
| QUEST-1 | Questions have text, status (open/investigating/answered/parked), answer note and links. | P0 |
| QUEST-2 | Related-object counts are shown; answering creates a note. | P1 |

### INBOX — capture and triage

| ID | Requirement | Priority |
| --- | --- | --- |
| INBOX-1 | Global quick capture (`Ctrl+Shift+Space`) stores text and an optional kind without requiring a project. | P0 |
| INBOX-2 | Inbox items can be converted to note, task, reference, experiment or question, preserving text and creating a link back. | P0 |
| INBOX-3 | Inbox badge shows untriaged count; items can be archived or deleted. | P0 |

### ACT — activity and journal

| ID | Requirement | Priority |
| --- | --- | --- |
| ACT-1 | Every create/update/delete/link/status change writes an append-only activity event in the same transaction as the change. | P0 |
| ACT-2 | Events record actor, project, object, action, summary, structured before/after changes, timestamp, source (ui/api/ai/job). | P0 |
| ACT-3 | Global and per-project timelines filter by date, actor and object type. | P0 |
| ACT-4 | The daily diff is computed deterministically from events for a timezone-aware local date. | P0 |
| ACT-5 | Digest shows added/modified/removed/completed counts and item lists per project, independent of AI. | P0 |
| ACT-6 | AI interpretation is generated on demand or by schedule, stored with the exact diff it interpreted. | P1 |
| ACT-7 | Digest regeneration is idempotent per user/date and preserves the previous version for comparison. | P1 |
| ACT-8 | Weekly/monthly rollups. | P2 |

### SRCH — search

| ID | Requirement | Priority |
| --- | --- | --- |
| SRCH-1 | Full-text search across title, body/abstract, tags and metadata; filters by type, project, tag, date. | P0 |
| SRCH-2 | Results show type, project, highlighted snippet and updated date; keyboard navigable. | P0 |
| SRCH-3 | Command palette reuses search with a unified action registry. | P0 |
| SRCH-4 | Semantic search over embedded chunks when an embedding provider is configured. | P1 |
| SRCH-5 | Hybrid retrieval fuses BM25 and vector results (RRF); the rerank hook exists but bundled adapters do not implement it in v1. | P1 |
| SRCH-6 | Saved searches and alerts. | P3 |

### AI — assistant

| ID | Requirement | Priority |
| --- | --- | --- |
| AI-1 | AI features are disabled with a clear reason when no provider is configured; the rest of the app is unaffected. | P0 |
| AI-2 | Chat streams tokens over SSE, persists conversations/messages, and survives reconnects (completed messages only). | P0 |
| AI-3 | Conversation scope: global, project, or explicit selection (chips of objects). | P0 |
| AI-4 | Retrieved context is chunked, budgeted and injected with source markers; answers must cite `[n]`; unknown citation indices are stripped. | P0 |
| AI-5 | Citations render as links to the object anchor (PDF page or note block) and are persisted with the message. | P0 |
| AI-6 | Contextual actions: summarise, compare selection, find related, turn message into note, extract tasks. | P1 |
| AI-7 | Provider configuration supports OpenAI-compatible endpoints (including Ollama) and a deterministic fake for tests. | P0 |
| AI-8 | API keys are encrypted at rest and never returned by the API. | P0 |
| AI-9 | Token usage per message/provider is recorded; cost is reserved (`costUsd`) but not computed in v1. | P1 (partial) |
| AI-13 | Reference metadata extraction supports text, page-image and OCR modes, returns the raw provider output for inspection, and applies only validated fields. | P1 |
| AI-10 | Embeddings index objects incrementally and can be rebuilt; model/dimension changes trigger a safe reindex. | P1 |
| AI-11 | AI cannot execute arbitrary tools or mutate data without an explicit user action endpoint. | P0 |
| AI-12 | AI-discovered connections and autonomous agents. | P3 |

### DATA — export, backup, restore

| ID | Requirement | Priority |
| --- | --- | --- |
| DATA-1 | Export a note as Markdown, a reference as BibTeX, a project or the workspace as a ZIP. | P0 |
| DATA-2 | Workspace ZIP contains a versioned manifest, JSONL of every table, Markdown notes, BibTeX, attachments, activity events and checksums. | P0 |
| DATA-3 | Create manual and scheduled backups using a consistent SQLite snapshot plus attachments. | P0 |
| DATA-4 | Backups are verified (checksums + SQLite integrity check) and retention-pruned. | P0 |
| DATA-5 | Restore a validated backup archive into the running instance behind an explicit confirmation; a pre-restore safety backup is automatic. | P0 |
| DATA-6 | A failed restore leaves the existing database untouched. | P0 |
| DATA-7 | External backup destinations (S3/NAS). | P2 |
| DATA-8 | Object-level restore from portable exports. | P2 |

### UI — interface and theming

| ID | Requirement | Priority |
| --- | --- | --- |
| UI-1 | Two-mode shell: fixed navigation rail + content; persistent AI panel that expands. | P0 |
| UI-2 | Six palettes (Lavender, Sakura, Sage, Ocean, Midnight, Graphite) × light/dark/system, implemented as CSS tokens. | P0 |
| UI-3 | Theme is applied before first paint and persisted server-side and locally. | P0 |
| UI-4 | Accent override via colour picker with automatic contrast-safe derived tokens. | P1 |
| UI-5 | Global command palette (`Ctrl/Cmd+K`), quick capture (`Ctrl/Cmd+Shift+Space`), shortcut help (`?`). | P0 |
| UI-6 | Every list has loading, empty and error states; every destructive action confirms. | P0 |
| UI-7 | Keyboard navigation for palette, modals and board; visible focus rings. | P0 |
| UI-8 | Responsive down to 768 px (rail collapses; AI panel becomes a sheet). | P1 |
| UI-9 | Configurable dashboard widgets. | P2 |

### OPS — operations

| ID | Requirement | Priority |
| --- | --- | --- |
| OPS-1 | Single `npm start` serves API and built SPA on one port from one data directory. | P0 |
| OPS-2 | Configuration via environment variables with validated defaults and a documented data layout. | P0 |
| OPS-3 | Migrations run automatically at boot after a safety snapshot; failures abort startup. | P0 |
| OPS-4 | `/healthz` reports DB, blob store, migrations and worker status without leaking secrets. | P0 |
| OPS-5 | Structured logs with request IDs; sensitive fields redacted. | P0 |
| OPS-6 | Docker image and systemd example; reverse-proxy/TLS guidance. | P1 |
| OPS-7 | Metrics endpoint (Prometheus). | P3 |

## 2. Non-functional requirements

| Area | Target |
| --- | --- |
| Startup | < 2 s on a laptop with 10k objects |
| API latency | p95 < 150 ms for list/detail endpoints at 10k objects |
| Search latency | p95 < 100 ms for FTS at 10k objects |
| Note autosave | committed < 1.5 s after typing stops; no data loss on tab close after debounce flush |
| Concurrency | 1 writer (SQLite WAL), many readers; background jobs must never block the UI for > 1 s |
| Uploads | default max 50 MB/file, configurable; streamed, never buffered fully in memory for large files |
| Security | OWASP ASVS L1-aligned for auth, session, input handling, file upload; documented threat model |
| Accessibility | WCAG 2.2 AA for text/UI contrast, keyboard operable, reduced motion respected |
| Privacy | No outbound calls except configured AI/URL ingestion and DOI lookup; no telemetry |
| Portability | Node 22+; no native services beyond SQLite; data directory movable |
| Backup | RPO ≤ 24 h (daily) or manual; RTO < 10 min for < 5 GB workspace |
| Maintainability | Module boundaries enforced by lint rules; every table documented; ADRs for irreversible choices |

## 3. Key user journeys (acceptance scenarios)

1. **Morning review.** Open app → dashboard shows yesterday's digest, overdue tasks, inbox count → open digest → click a reference cited in the summary → land on its PDF page.
2. **Capture in flow.** Reading a paper elsewhere → `Ctrl+Shift+Space` → type idea → later triage into a note in project X; the inbox item records the conversion.
3. **Literature triage.** Upload three PDFs → extraction states update → DOI detected for one → set reading status → tag → ask AI to compare them → citations resolve to pages.
4. **Experiment record.** Create experiment → attach CSV → results markdown → link the paper that motivated it → ask AI to compare with the previous experiment.
5. **Weekly reflection.** Open journal for a past date → see deterministic diff → regenerate summary → copy "next steps" into tasks.
6. **Disaster recovery.** Lose the laptop → install Loom → upload latest backup → all objects, links, attachments, events and settings restored.
7. **AI outage.** Provider down → app still fully usable; AI panel shows degraded state; jobs retry with backoff; no data loss.
