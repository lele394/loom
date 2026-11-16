# 03 — Domain model

The domain rests on three concepts from the source design: **knowledge objects**, **relationships**, **events**. This document defines them precisely, including invariants the code must uphold.

---

## 1. The Research Object supertype

Every knowledge item shares identity and cross-cutting features:

```
ResearchObject
  id            string   (type-prefixed ULID, time-sortable)
  type          note | task | reference | experiment | question
  title         string
  projectId     string | null          (null = global / unfiled)
  status        string | null          (type-specific canonical status)
  version       integer                (optimistic concurrency)
  favorite      boolean
  createdAt, updatedAt, createdBy, updatedBy
  deletedAt     timestamp | null       (trash)
  metadata      JSON                   (denormalised, searchable subset)
```

Concrete types extend it in their own table with a 1:1 primary key (`notes.id → objects.id`). The supertype is not an ORM abstraction; it is a **physical table plus a registry** that tells the application how to:

- render a label and icon,
- compute the text body for search,
- build the client route,
- export the object,
- phrase its activity events,
- validate create/update payloads.

### Invariants

1. A subtype row exists iff its `objects` row exists (enforced by FK + repository discipline; there is no generic delete API that skips subtypes).
2. `objects.title` mirrors the subtype's display title; the repository updates both in one transaction.
3. `objects.status` is the canonical status used by filters (`todo`, `done`, `unread`, `open`, …).
4. `objects.version` increments exactly once per successful mutation of the object or its subtype.
5. Deletion is soft (`deleted_at`) for objects; activity events are never deleted. A purge job hard-deletes after 30 days.
6. `project_id` is the object's home project. Cross-project relevance is expressed with **links**, not multiple project ids.

### Why one project per object, not many

The source conversation asks for references shared across projects. Two mechanisms are enough:

- The reference lives in one project but can be **linked from any object in any project**; the UI shows "used in N projects".
- Literature can be moved or re-filed; duplicate records are avoidable because a reference can also live in the global collection (`project_id = null`).

A join table (`object_projects`) was rejected for v1: it complicates every query and the UI, while links already provide cross-project connectivity. This is reversible without data loss if multi-project membership becomes necessary.

## 2. Entity definitions

### Project

| Field | Type | Notes |
| --- | --- | --- |
| id | id | `prj_…` |
| name, description | text | |
| color | token name | one of the palette accents |
| status | active / archived | archived projects are read-only by default |
| settings | JSON | board defaults, digest preferences |
| createdAt, updatedAt, deletedAt | | |

A project also owns board columns. Deleting a project marks it and its objects deleted; restoration restores them together.

### Task

| Field | Type | Notes |
| --- | --- | --- |
| objective fields | | title/description from object |
| columnId | id | required; belongs to the task's project |
| priority | low/normal/high/urgent | |
| dueDate, startDate | date | local dates, no time component |
| completedAt | timestamp | set iff column is a done column or explicitly completed |
| position | integer | dense order within column; rewritten on move |
| checklist | JSON `[{id,text,done}]` | progress shown on cards |
| estimateMinutes | integer | |
| metrics | JSON | optional numeric result values |

**State machine:** any column can move to any other. Entering a column flagged `is_done` sets `completed_at` and emits `task.completed`; leaving clears it and emits `task.reopened`. Ordering is dense integers per column, rewritten inside the move transaction (≤ hundreds of cards; simpler and less bug-prone than fractional indexing).

**Project move:** a task may move to another project only through the task update path; the server reassigns `column_id` to the target project's first non-done column (or first column), rewrites positions, and logs `task.moved`. This prevents a task pointing at a column owned by another project.

### Note

```
Note {
  id, title, blocks: Block[], template, plainText, version
  pinned, favorite
}

Block {
  id: string            // stable, prefixed `blk_`
  type: paragraph|h1|h2|h3|bullet|numbered|todo|quote|code|callout|divider|equation|reference|task
  text: string          // markdown-ish inline content; for equation, LaTeX
  meta?: {
    checked?: boolean        // todo
    language?: string        // code
    tone?: 'info'|'warn'|'success'  // callout
    refId?: string           // reference/task embed
  }
}
```

- The canonical document is `blocks` JSON stored in `notes.blocks_json`.
- Blocks are index units: each block becomes a chunk with `locator = { blockId }` for citations.
- Wikilinks `[[Title]]` are parsed on save. Resolution order: same project, then global, then across projects; ambiguity resolves to the most recently updated and is reported in `saveDoc` warnings.
- `plainText` is derived on save and used for search/backlinks.
- `favorite` (on the object) is the cross-app star; `pinned` (on notes/tasks lists) only affects ordering within its list.
- Version snapshots store `{version, blocks, title, savedAt, reason}`; retention: 50 versions or 90 days.
- Autosave sends the full document with `expectedVersion`. Conflict returns 409 and the UI keeps the local draft, offering reload or overwrite (overwrite = save with `force: true`, which creates a snapshot first).

### Reference (literature)

| Field | Type | Notes |
| --- | --- | --- |
| citeKey | string | unique per workspace, e.g. `doe2024energy` |
| authors | JSON string[] | |
| year, publishedAt | | |
| venue | string | journal/conference |
| doi, url | string | |
| type | article/inproceedings/book/website/report/thesis/preprint/other | |
| abstract | text | |
| readingStatus | unread/reading/reviewed/archived | |
| rating | 0–5 | |
| notes | text | short annotations; long-form belongs in a linked note |
| extra | JSON | bibtex fields not mapped |

**PDF lifecycle:** attachment uploaded → blob stored → job `extract.attachment` → text + page map + detected DOI → job `index.object` → chunks (per ~1200 chars with page locators) + embeddings. Each stage has a status visible in the UI. Failure leaves the reference usable and sets an error message.

### Experiment

| Field | Type | Notes |
| --- | --- | --- |
| objective, hypothesis, method | text (markdown) | |
| environment | JSON key/value | hardware, OS, compiler, config |
| results | text (markdown) | |
| metrics | JSON `[{name, value, unit}]` | |
| status | planned/running/completed/abandoned | |
| startedAt, endedAt | date | |
| attachments | via attachments | CSV/log/plot |

### Research question

| Field | Type | Notes |
| --- | --- | --- |
| question | text | title = question (object title) |
| status | open/investigating/answered/parked | |
| answerNoteId | id? | created on "answer" |
| context | text | why it matters |

### Inbox item

| Field | Type | Notes |
| --- | --- | --- |
| body | text | raw capture |
| kind | idea/reference/task/question/note/experiment | hint only |
| status | new/triaged/archived | |
| triagedObjectId | id? | set on conversion |
| projectId | id? | optional at capture time |

Inbox items are **not** research objects in v1 (they have no links/search body of their own). They are cheap, high-volume capture records. Conversion creates a real object and records `inbox.triaged`.

### Conversation and Message

```
Conversation { id, title, scope: global|project|selection,
               projectId?, contextObjectIds: string[], providerId?, model? }
Message { id, conversationId, role: user|assistant|system,
          content, citations: Citation[], usage {in,out,costUsd}?,
          provider?, model?, error?, createdAt }
```

- Conversations are first-class objects (type `conversation` in the object supertype? **No** — see below).
- **Decision:** conversations are stored outside the object supertype. They have their own listing in the AI panel, are not linkable knowledge, and do not appear in global search by default (they are searchable via a dedicated filter). This keeps the knowledge model clean. They are still exported.

### Citation

```json
{
  "index": 1,
  "objectId": "ref_…",
  "objectType": "reference",
  "title": "Energy-Efficient …",
  "locator": { "page": 4, "chunkId": "chk_…" },
  "excerpt": "…",
  "url": null
}
```

Indices are assigned at retrieval time. The model cites `[1]`; the server maps indices back to citations, drops unknown ones, and persists the result with the message.

### Activity event

```
ActivityEvent {
  id, seq (monotonic), occurredAt,
  actorId, projectId?, objectId?, objectType?, objectTitle?,
  action: 'note.created' | 'task.moved' | …,
  summary: 'Created note "Frequency scaling"',
  changes: { field: { from, to } } | null,
  source: 'ui' | 'api' | 'job' | 'ai',
  requestId?
}
```

Events are written inside the mutation transaction. `summary` is generated by the server (deterministic, from typed data), never by an LLM.

### Digest

```
Digest { id, userId, date (YYYY-MM-DD), timezone,
         diff: DailyDiff, summaryMarkdown?, model?, status: pending|ready|failed,
         generatedAt, regeneratedCount, sourceEventSeq }
```

`DailyDiff` is deterministic:

```json
{
  "date": "2026-11-16",
  "timezone": "Europe/Paris",
  "totals": { "added": 9, "updated": 4, "completed": 2, "removed": 1 },
  "byProject": [{
    "projectId": "prj_…", "projectName": "HPC",
    "added": [{ "type": "reference", "id": "ref_…", "title": "…" }],
    "updated": [{ "type": "note", "id": "note_…", "title": "…", "fields": ["blocks"] }],
    "completed": [{ "type": "task", "id": "task_…", "title": "…" }],
    "removed": [{ "type": "task", "id": "task_…", "title": "…" }],
    "eventCount": 14
  }],
  "eventCount": 18,
  "eventSeqRange": [1200, 1218]
}
```

## 3. Relationships

Typed directed edges in `links`:

| Kind | Meaning | Created by |
| --- | --- | --- |
| `mentions` | Note body references an object (`[[Title]]`) | wikilink parser |
| `relates` | Generic "related to" | user |
| `cites` | Note/experiment/task uses a reference | user or embed block |
| `motivates` | Reference motivates an experiment/question | user |
| `answers` | Note/experiment answers a question | user, or `question.answer` |
| `derived_from` | Conversation → note, inbox → object | conversion actions |

Rules:
- Links are unique by `(source_id, target_id, kind)`.
- Backlinks are the reverse query; the object detail API returns both.
- Deleting an object soft-deletes its links; restoring recreates them from the stored rows (links are soft-deleted too, not erased).
- Self-links are rejected. Cross-type links are allowed; the registry supplies labels.
- Wiki-link edges are **recomputed** on note save for that note only.
- Users are never hard-deleted in v1: `objects.created_by` is an FK, and activity history must remain attributable. A future user-deletion feature must reassign or anonymise objects first.

## 4. Lifecycle and deletion

```
active ──delete──▶ trashed ──restore──▶ active
                     │
                     └──purge (30d or manual)──▶ erased
```

- Trash is global and per-project; restore is available from Settings → Trash (P1 UI; P0 API).
- Purging deletes the subtype row, tags/links, chunks, FTS rows, versions and attachments that are referenced only by the purged object. Activity events remain (they reference IDs, not rows).
- Project delete cascades soft-delete to its objects; project restore restores objects that were deleted by that same operation (tracked by a `deleted_by_project_operation` marker? **Simplification:** restore all trashed objects whose `project_id` matches; user-confirmed preview).
- Archiving a project is read-only, not deletion: writes are rejected with `project_archived` unless the client passes `?override` (UI does not offer it).

## 5. Tagging

- Tags are global, case-insensitive unique (`collate nocase`), optionally coloured.
- An object may have up to 30 tags; names are 1–40 chars, no leading `#`, trimmed, comma-free.
- Tags are polymorphic via `object_tags`, which also lets the palette search tags.
- Renaming a tag updates all associations atomically; merging tags is deferred.

## 6. Attachments

- An attachment is a file linked to exactly one object (`object_id`), with `kind` (pdf/image/csv/data/other), original filename, MIME, size, hash, optional extracted-text status.
- Blobs are content-addressed and shared: two attachments may point to the same blob; deletion decrements implicit refcount by checking other rows before removing the file.
- PDF text extraction produces plain text plus a page-offset map (`[{page, start, end}]`) used for citation locators.

## 7. Identifiers

`<prefix>_<26-char Crockford base32 ULID>` — lexicographically sortable, no external dependency. Knowledge objects use the `obj_` prefix; notes, tasks, references, experiments and questions share that id in their typed tables.

Prefixes: `usr`, `prj`, `obj`, `note`, `tsk`, `ref`, `exp`, `que`, `inb`, `cnv`, `msg`, `att`, `tag`, `lnk`, `evt`, `job`, `dgt`, `chk`, `bkp`, `col`, `ver`.

IDs are opaque to clients. Sort by `created_at, id` for stability.

## 8. Domain events (in-process)

The event bus is a convenience for decoupled listeners, not the source of truth:

| Event | Listeners |
| --- | --- |
| `object.created/updated/deleted` | search indexer, embedding enqueue, digest invalidation |
| `attachment.extracted` | reference DOI enrichment, re-index |
| `note.saved` | wikilink resolution, version snapshot retention |
| `conversation.message.completed` | usage ledger |

Listeners must be idempotent and must not assume the transaction is committed. Durable follow-up work is enqueued as a job **inside** the transaction; listeners only handle ephemeral concerns.

## 9. Key invariants checklist (used in review)

- [ ] No object can exist without its subtype row.
- [ ] No mutation without an activity event.
- [ ] No cross-project link without both endpoints existing.
- [ ] No hard delete of activity history.
- [ ] No timestamp without UTC storage; dates are `YYYY-MM-DD` local by contract.
- [ ] No AI-generated content stored as fact without provenance (`model`, `prompt version`, `message_id`).
- [ ] No note save can silently clobber another version.
- [ ] No attachment served inline with an untrusted MIME type.
