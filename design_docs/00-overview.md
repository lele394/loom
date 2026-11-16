# 00 — Overview, principles and scope

**Product:** Loom — a personal research OS.
**Status:** v1 specification (derived from `conversation.md`, hardened in `16-gap-analysis.md`).
**Audience:** the implementer (human or agent) and future maintainers.

---

## 1. What Loom is

Loom is a self-hosted web application for one researcher (multi-user-ready) that unifies:

- **Projects** — independent research workspaces, organised as logical containers in one database.
- **Tasks** — Kanban boards with deadlines, priorities and links to research objects.
- **Notes** — block-based, linkable notes with version history and backlinks.
- **Literature** — a reference database with PDFs, URLs, metadata, tags and BibTeX.
- **Experiments** — structured records with objectives, environments, results and datasets.
- **Research questions** — the "things to understand" that tasks alone cannot express.
- **Inbox** — frictionless capture and later triage.
- **Activity & Journal** — an append-only event log, deterministic daily diffs and an AI research digest.
- **AI assistant** — context-scoped chat over your own material, with mandatory citations, plus semantic search.
- **Search** — one search box across every object type, with full-text and optional semantic retrieval.

Everything is reachable from a single interface: a research IDE with a persistent AI panel.

## 2. Product principles

1. **The notebook works without AI.** Every non-AI feature is fully functional with no provider configured. AI is an additive layer with explicit degraded states.
2. **The user owns the data.** SQLite on disk, content-addressed attachments, documented formats, complete export without the app.
3. **History is a first-class feature.** Activity is recorded by the server, append-only, and never reconstructed by an LLM.
4. **Capture before organising.** Quick capture is global and never forces a project choice.
5. **One object model.** Notes, tasks, references, experiments and questions share identity, links, tags, events and search.
6. **Modular monolith.** One process, one database, explicit module boundaries; no distributed systems until proven necessary.
7. **Boring, replaceable infrastructure.** SQLite, local files, in-process jobs. Every seam that a larger deployment would need (Postgres, S3, OIDC, external worker) is an interface, not a rewrite.
8. **Citations or silence.** AI answers grounded in your material must cite source objects and anchors; otherwise the assistant states that it could not find support.
9. **Accessible by default.** Keyboard-first, WCAG AA text contrast, reduced-motion support, complete focus states.
10. **No dark patterns, no telemetry, no accounts.** Outbound network calls happen only for explicitly configured AI/URL-ingestion features.

## 3. Five pillars (from the source design)

| Pillar | Meaning |
| --- | --- |
| Organise | Projects, boards, deadlines, questions |
| Capture | Inbox, notes, references, experiments |
| Connect | Typed links, backlinks, cross-project references |
| Understand | Search, RAG chat, summaries |
| Reflect | Activity timeline, diffs, daily digest |

## 4. Personas

**Primary — the researcher (single user).** Runs Loom locally or on a small server. Works in multi-hour sessions. Wants low friction, fast search, reliable history and no vendor lock-in.

**Secondary — the returning researcher.** Opens Loom after weeks away and needs to reconstruct context: "what was I doing, what changed, what is next?" This persona justifies the journal, timeline and dashboard.

**Tertiary — the future collaborator (not v1).** The schema carries `user_id` and project membership so that sharing can be added without a data migration, but v1 has one account and no sharing UI.

## 5. Scope

### v1 ships (P0/P1)

Auth (single account, sessions), projects, Kanban, block notes with versions/backlinks, literature with PDF upload and URL capture, experiments, research questions, inbox, global search, activity log, deterministic diffs, AI chat with citations/streaming, embeddings + hybrid search, daily digest, export, backup/restore, theming (6 palettes × light/dark/system), command palette, quick capture, dashboard.

### Deliberately deferred (documented, with extension points)

Calendar view, knowledge-graph visualisation, AI-discovered connections, decision log, milestones UI, meeting notes, plugin loading, real-time collaboration/CRDT, multi-user sharing, mobile apps, offline PWA sync, RIS import, citation styles beyond BibTeX, CSV charting, object-level restore from portable exports.

See `15-roadmap-risks.md` for triggers that justify each.

## 6. Non-goals

- A Zotero replacement (no browser connector, no citation-style engine, no group libraries).
- A general note-taking app (no publish/share, no mobile capture).
- A hosted SaaS (no billing, no org management, no telemetry).
- A model provider (no bundled weights; bring your own OpenAI-compatible endpoint or Ollama).
- Real-time multi-device sync (one server, optimistic concurrency, refresh to see remote changes).

## 7. Glossary

| Term | Definition |
| --- | --- |
| **Research object** | Any addressable knowledge item: note, task, reference, experiment, question. Has a UUID, type, title, project, tags, links, events. |
| **Project** | Logical research workspace. All objects may belong to a project or be global. |
| **Attachment** | A binary file stored in the content-addressed blob store and linked to an object. |
| **Chunk** | A retrievable text unit derived from an object (note block, PDF page section), with a locator for citation. |
| **Activity event** | An immutable record of a mutation (`task.completed`, `note.updated`, …) with before/after changes. |
| **Digest** | The deterministic daily diff plus an optional AI interpretation for one local date. |
| **Job** | A durable, retryable unit of background work (extract PDF, embed object, generate digest, backup). |
| **Session** | A server-side authenticated browser session identified by an HttpOnly cookie. |
| **Provider** | A configured AI endpoint (OpenAI-compatible or fake) plus per-capability model names. |
| **Scope** | The context boundary of an AI conversation: global, project, or explicit selection. |

## 8. Success criteria for v1

1. A new user can set up an account, create a project, write a linked note, add a task and upload a paper in under five minutes without reading documentation.
2. Killing the server and restarting loses no committed data; a backup can be restored into an empty data directory.
3. Every mutation appears in the activity feed with actor, timestamp and a human-readable summary.
4. A daily digest can be generated from the diff with AI disabled (deterministic section) and with AI enabled (interpretation).
5. Search returns results across notes, tasks, references, experiments and questions in under 100 ms at 10k objects.
6. All AI answers that cite sources link to a resolvable object anchor; ungrounded answers are visibly marked.
7. Light and dark palettes both meet AA contrast for body text; theme switching causes no flash.
8. The full workspace exports to a ZIP that contains readable Markdown, BibTeX, JSONL and original files.
