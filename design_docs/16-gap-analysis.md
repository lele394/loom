# 16 — Gap analysis: what the source design was missing

The source conversation is a strong product vision but not a buildable specification. This document is the critical review: every gap that would have blocked or distorted implementation, its severity, and how Loom resolves it. "Blocker" means development would stall or produce a wrong architecture; "High" means a feature would be built twice or unsafely.

---

## 1. Cross-cutting gaps

| # | Gap in the source | Severity | Why it matters | Resolution |
| --- | --- | --- | --- | --- |
| G1 | No deployment/identity model beyond "Authentik or native" | Blocker | Nothing can ship without sessions, CSRF, password storage, first-run | `06-auth-security.md`: scrypt, server sessions, CSRF double-submit, setup flow, rate limits |
| G2 | Stack chosen for a team-scale SaaS (Postgres, Redis, Celery, two languages) for a single-user notebook | High | Operational overhead, two toolchains, sync bugs between DB and queue | ADR 0002/0005: SQLite WAL + FTS5 + in-process worker; ports preserve the upgrade path |
| G3 | No transaction/consistency model between state, events and background work | Blocker | "Every change generates an event" silently breaks on partial failure | Same-transaction event + job enqueue; no outbox needed (`08`) |
| G4 | No API contract | Blocker | Frontend/back-end drift, no error semantics | `05-api-design.md`: REST conventions, error envelope, SSE, pagination, concurrency |
| G5 | No migration or schema-evolution strategy | Blocker | Upgrades would corrupt or refuse to start | Versioned SQL migrations, checksums, pre-migration backup (`04`, `13`) |
| G6 | Backup described as a feature, never as an algorithm | Blocker | Restore is the hard half; untested backups are worthless | `12`: snapshot, manifest, checksums, validation-before-mutation, transactional import |
| G7 | No soft-delete/trash/retention semantics | High | "Deleted objects generate events" but no restore/purge rules | `03 §4`: trash, restore, 30-day purge, events retained |
| G8 | No concurrency model for edits/multi-tab | Blocker | Note autosave would silently overwrite work | Version token + 409 + force-with-snapshot (`03`, `05`) |
| G9 | No observability or health model | High | Failures (disk full, worker stuck, bad migration) are invisible | `13`: request IDs, structured logs, `/readyz`, job visibility |
| G10 | No accessibility or theming mechanics | High | Pastel-only text and late theme application produce unreadable/flashing UI | `09`: tokens, pre-paint script, AA contrast rules, keyboard map |
| G11 | No testing strategy, especially for AI | High | AI paths become untestable and regress silently | `14`: fake provider, golden diffs, integration harness |
| G12 | No explicit non-goals | Medium | Scope creep toward Zotero/Notion/SaaS | `00 §6` |
| G13 | "Plugin system" listed without boundaries | Medium | Premature dynamic loading risks security and API churn | In-process registries now, dynamic plugins deferred (`02 §7`, `15`) |

## 2. Data model gaps

| # | Gap | Severity | Resolution |
| --- | --- | --- | --- |
| D1 | "Research Objects" named but no supertype schema or invariant | Blocker | `objects` table + typed tables + registry (`03`, `04`) |
| D2 | Notes have block IDs but no storage/citation model | Blocker | `blocks_json` canonical, chunks per block, locator `{blockId}` (`03`, `11`) |
| D3 | Reference "belongs to multiple projects" conflicts with project containers | High | Home project + typed cross-project links; rationale documented (`03 §1`) |
| D4 | No chunk table, so citations, semantic search and RAG have nowhere to point | Blocker | `chunks` with locators and model-tagged embeddings (`04`, `10`) |
| D5 | No tags schema (folders vs tags vs projects unclear) | High | Global `tags` + `object_tags`, case-insensitive unique (`03 §5`) |
| D6 | "Relationships" have no direction, type or backlink semantics | High | `links` with kinds, uniqueness, soft delete, backlink queries (`03 §3`) |
| D7 | No ordering strategy for Kanban | High | Dense integer positions rewritten transactionally (`03 §2`) |
| D8 | No attachment/dedup model | High | Content-addressed blobs, attachment rows, GC (`11`) |
| D9 | No job/quota/backup tables in the ERD | High | Added in `04` |
| D10 | Conversation storage relative to objects unspecified | Medium | Conversations excluded from knowledge objects, still exported (`03 §2`) |
| D11 | No inbox entity, although quick capture is "very high priority" | High | `inbox_items` + conversion semantics (`03 §2`) |
| D12 | No version-history retention policy | Medium | 50 versions / 90 days, append-only restore (`03 §2`) |
| D13 | No mention of generated text provenance | Medium | `model`, prompt version, citations stored per message/digest |

## 3. AI gaps

| # | Gap | Severity | Resolution |
| --- | --- | --- | --- |
| A1 | "Chat with refs" without chunking, retrieval or grounding rules | Blocker | Ingestion → chunks → hybrid retrieval → cited context (`07 §2–4`) |
| A2 | "Citations non-negotiable" but no citation schema/anchor | Blocker | `Citation` with object + locator + excerpt; validation strips unknown indices (`07 §4`) |
| A3 | No embedding lifecycle (model changes, partial indexing) | High | Model-tagged vectors, stale filtering, backfill jobs, coverage status (`10 §2`) |
| A4 | Hybrid retrieval named but fusion/reranking unspecified | High | BM25 weights, RRF (k=60), optional rerank with fallback (`10 §5`) |
| A5 | No prompt-injection defence for ingested PDFs | High (security) | Untrusted `<source>` delimiting, no tools, no URL fetching from content (`06 §9`) |
| A6 | No provider failure semantics | High | Normalised errors, one pre-stream retry, timeouts, degraded UI (`07 §1,8`) |
| A7 | No cost/usage accounting or budget | Medium | Per-message usage, price table, optional daily budget (`07 §7`) |
| A8 | Daily summary could hallucinate history | Blocker | Diff computed first from events; LLM sees only the diff (`07 §5`) |
| A9 | No timezone/day-boundary or digest idempotency | High | Local-date windows, unique (user,date), job key, staleness detection (`08 §3`) |
| A10 | No testing story for AI | High | Deterministic fake provider + retrieval fixtures (`14`) |
| A11 | No privacy statement for what leaves the machine | High | Explicit provider notice, no telemetry, local embeddings option (`07 §7`) |
| A12 | "AI research connections" without a data/feature design | Low | Deferred; retrieval APIs are the foundation (`15`) |

## 4. Deliberate divergences from the source (and why)

| Source recommendation | Loom v1 | Rationale |
| --- | --- | --- |
| PostgreSQL + pgvector | SQLite + FTS5 + JS cosine | Single-user scale; one file to back up; ports allow the swap |
| Redis + Celery/ARQ | SQLite jobs + in-process worker | No extra service; transactional enqueue; single user does not need throughput |
| FastAPI + React (two languages) | TypeScript end-to-end | One toolchain, shared types, simpler hiring/maintenance for a personal project |
| Tailwind CSS | Hand-written CSS with design tokens | Theme tokens are the product feature; no utility-class churn; smaller dependency surface |
| "Reference belongs to multiple projects" | One home + cross-project links | Simpler queries/UI; solves the same use case; reversible |
| Notes as rich blocks with images/tables | Text-first markdown blocks; images/files as attachments | Ships a reliable editor now; rich embeds are P2 |
| Full calendar (P2) | Due dates + dashboard agenda | Calendar needs a scheduling model not required for the core loop |
| Configurable dashboard (P0) | Fixed widget grid, visibility toggles later | A dashboard builder is a product in itself; not on the critical path |
| "Individual project restoration" | Full restore + documented export workaround | Selective import needs merge/ID-conflict semantics; P2 with a clear path |
| Local-first/offline mode | Server-local, single instance | True offline requires sync/conflict resolution; explicitly out of scope |
| Authentik/OIDC | Local auth | Zero external dependency for the default deployment; OIDC seam documented |

## 5. Additional product gaps found during review (now addressed or scoped)

1. **Onboarding** — first-run setup plus optional starter project; empty states with next actions.
2. **Global "recently viewed" / favourites** — objects have `favorite` + `pinned`; dashboard shows recents.
3. **Bulk actions** — out of v1; single-item operations only (documented limitation).
4. **Undo** — destructive actions use confirm + trash; no global undo stack in v1.
5. **Notifications** — no email/push; dashboard surfaces overdue tasks and inbox count by design.
6. **Reading queue** — `reading_status` + filters; no separate queue UI in v1.
7. **Multi-tab consistency** — optimistic versioning catches conflicts; no live push; refresh resolves.
8. **Import from other tools** — BibTeX import covers literature; Markdown import of notes is P2.
9. **Search result grouping** — flat ranked list with filters; grouping is P2.
10. **Archived projects** — read-only, explicit override rejected in UI; documented.
11. **Deleted tags** — associations removed; no undo (confirmation required).
12. **AI conversation management** — list, rename, delete, export; no folders/search inside chat in v1.
13. **Prompt/output language** — follows the user's language; no i18n of the UI in v1 (English UI).
14. **Licensing/dependency policy** — documented in README; no GPL-only dependencies.
15. **Data retention for events** — kept forever by design (research history); purge only via full reset.

## 6. Residual risks accepted in v1

| Risk | Mitigation / trigger |
| --- | --- |
| SQLite write contention with heavy PDF jobs | Single-concurrency worker; short transactions; trigger: move extraction to worker_threads if p95 UI > 300 ms |
| Brute-force vector scan slows at > 50k chunks | Cap + warning; trigger: sqlite-vec adapter |
| No database encryption at rest | Full-disk encryption guidance; trigger: SQLCipher evaluation |
| No live collaboration | Optimistic concurrency; trigger: multi-user requirement |
| Backup size grows with attachments | Dedup + retention; trigger: incremental backup format |
| Markdown renderer edge cases | Escape-first + tests; trigger: adopt a vetted sanitizer if raw HTML is ever supported |
| PDF text extraction quality | Page-anchored citations always show excerpts; manual notes remain the fallback |
| Restore of large archives is synchronous | Clear progress UI + generous timeout; trigger: streaming restore job |
| Prompt quality drifts across models | Prompt versioning + manual eval checklist; trigger: automated eval harness |

## 7. Traceability summary

Every capability promised in `conversation.md` is either implemented in v1 or explicitly deferred with a trigger:

- Projects, Kanban, notes/blocks, literature/PDF/URL, links, activity, inbox, experiments, questions, search, AI chat/citations, digest, themes, command palette, export, backup/restore → **v1**.
- Calendar, knowledge graph, AI connections, decision log, meetings, milestones UI, RIS, charts, offline, plugins, multi-user → **deferred** (`15-roadmap-risks.md`).

The design is therefore complete enough to build without inventing architecture mid-flight, while leaving reversible seams for the parts that were consciously postponed.
