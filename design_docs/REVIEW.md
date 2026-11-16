# Design review — findings and resolutions

**Reviewer:** architecture pass on 2026-11-16
**Scope:** `00`–`16`, ADRs 0001–0014
**Method:** consistency read-through, schema-to-API trace, requirement-to-endpoint trace, failure-mode walkthrough, security pass.

This is the documented review the build plan depends on. Every finding below was either fixed in the docs or turned into a plan item.

---

## 1. Verdict

The specification is buildable and internally consistent after the fixes below. No blocker remains. The main risks are execution scope (many surfaces) and the editor/AI polish, not architecture.

## 2. Findings

### Critical / correctness

| # | Finding | Resolution |
| --- | --- | --- |
| R1 | `activity_events` lacked a stored object title, so the daily diff and timeline would need to join `objects` — which fails for purged objects and adds cost. | Added `object_title` to the table and to the `ActivityEvent` shape; events snapshot the title at write time. |
| R2 | FTS column order made BM25 weights and `snippet()` indices error-prone (`object_id` first, unindexed). | Reordered to `title, body, tags, object_id UNINDEXED`; weights `8,1,3`; snippet column 1. Code and docs aligned. |
| R3 | Backup restore would import the virtual FTS table row-by-row, risking shadow-table surprises. | Restore skips both `search_fts` and `chunks_fts`; a `search.reindex` job runs immediately after restore. Documented in `12`. |
| R4 | Generic `PATCH /objects/:id {title}` created two write paths with different validation for titles. | Removed title from the generic endpoint; titles change only through typed endpoints. |
| R5 | Moving a task to another project via generic object update would leave `tasks.column_id` pointing at a column of the old project. | Defined explicit semantics: project move reassigns the task to the target project's first column and logs a move; documented in `03` and validated server-side. |
| R6 | Restore would also import `sessions`, resurrecting old sessions and potentially locking out the current user. | Restore never imports sessions or jobs; all sessions are deleted after restore and the UI forces re-login. |
| R7 | `source_event_seq` was ambiguous (a single number for a range). | Defined as the maximum event seq at generation, used for staleness detection. |
| R8 | Reference/project membership ambiguity could produce duplicated papers. | ADR 0013: one home project + typed cross-project links; UI shows linked projects. |

### High

| # | Finding | Resolution |
| --- | --- | --- |
| R9 | Users had an FK from `objects.created_by`; deleting a user would either break or cascade. No rule existed. | v1 never hard-deletes users; documented. Future deletion must reassign or anonymise. |
| R10 | `favorite` and `pinned` overlapped without semantics. | Favorite = cross-app star/filter; pinned = ordering within note/task lists; documented in `03`. |
| R11 | Restore was described as synchronous without stating downtime/write-blocking behaviour. | Maintenance flag rejects writes with `503 restore_in_progress`; generous timeout; documented. |
| R12 | `/board` and `/projects/:id/board` existed in different drafts. | Single route `/projects/:id/board`; all column operations scoped under the project. |
| R13 | The dashboard had no aggregation endpoint, forcing 6+ client requests and inconsistent counts. | Added `GET /dashboard` returning counts, due tasks, inbox count, recent activity and yesterday's digest. |
| R14 | Search index consistency rules for note edits and re-chunking were implicit; stale chunks could accumulate. | Index service deletes all chunks for an object before inserting; documented in `10 §2`; tested. |
| R15 | Digest generation could be triggered concurrently, duplicating AI spend. | Job idempotency key includes diff hash; concurrent enqueues coalesce; documented. |
| R16 | Env-based demo seeding was promised but not designed. | Dropped `LOOM_SEED_DEMO` from the critical path; setup offers an optional starter project (no fake content). |
| R17 | Password reset was mentioned without a mechanism. | Ship `scripts/reset-password.ts`; documented in `06`. |
| R18 | Inserting events had no FK to users (good) but this was not stated, inviting a "fix" that would erase history. | Documented: activity is intentionally non-FK so history survives user/object deletion. |

### Medium

| # | Finding | Resolution |
| --- | --- | --- |
| R19 | Requirement traceability was manual and easy to break. | `PLAN.md` maps phases to requirement IDs; `14` requires IDs in commits/PRs. |
| R20 | The API had no explicit response for empty searches or no-provider AI. | Documented: empty search returns `results: []` with `engines`; AI returns `503 ai_unavailable` with a reason code. |
| R21 | Note versions could grow unbounded. | Retention: 50 versions or 90 days; throttled snapshots; documented. |
| R22 | `PATCH /settings/appearance` had a `PUT` variant in an early draft. | Single `PATCH` endpoint; pre-paint uses localStorage. |
| R23 | Attachment GC could delete blobs used by an in-flight upload. | 24 h mtime grace period; GC skipped during backups; documented in `11`. |
| R24 | Test strategy omitted SSE client parsing and download streaming. | SSE event ordering is a contract test; downloads are integration tested (range + disposition). |
| R25 | No statement on UI language/i18n. | English UI in v1; user content and AI answers follow the user's language. Documented in `16`. |
| R26 | Theming docs named palettes without concrete values, risking inconsistent implementation. | Concrete token tables in `09`; implementation uses those values. |

## 3. Requirement traceability spot-check

| Requirement | Where implemented |
| --- | --- |
| AUTH-1..7 | `modules/auth`, `http/authGuard`, setup/login UI |
| PROJ-1..5 | `modules/projects`, project pages |
| TASK-1..5 | `modules/tasks`, board UI, dashboard |
| NOTE-1..7 | `modules/notes`, editor, versions panel |
| LIT-1..5 | `modules/literature`, upload/extraction jobs |
| EXP-1..4 | `modules/experiments` |
| QUEST-1 | `modules/questions` |
| INBOX-1..3 | `modules/inbox`, quick capture |
| ACT-1..5 | `core/activity`, journal page |
| SRCH-1..4 | `modules/search`, palette |
| AI-1..7, AI-11 | `ai/`, chat panel, SSE |
| DATA-1..6 | `modules/export`, `modules/backup` |
| UI-1..7 | web shell, theme tokens, command registry |
| OPS-1..5 | config, migrations, `/readyz`, logging |

## 4. Review checklist

- [x] Every requirement has an endpoint or a UI surface.
- [x] Every table has a documented owner, indexes and deletion semantics.
- [x] Every mutation path writes an activity event and, when needed, a job.
- [x] Every AI call has a timeout, an error path and a degraded mode.
- [x] Every file write is atomic and path-safe.
- [x] Every destructive operation is confirmed and recoverable where feasible.
- [x] Every token is defined in both light and dark modes.
- [x] No feature depends on a service the single-binary deployment cannot run.
- [x] Deferred features have a trigger, not just a "later".

## 5. Residual issues consciously accepted

1. Full-text search over extracted PDF text happens via chunks, not object FTS. A query matching only PDF body text returns the reference through its best chunk, not through `search_fts`; the response contract includes locators. Accepted for index size and simplicity.
2. Restore is all-or-nothing. Object-level recovery is a documented workaround.
3. No encryption at rest. Deployment guidance compensates.
4. No automated browser tests. Manual checklist compensates.
5. AI answer quality is model-dependent; grounding and citations are enforced structurally, not semantically.

## 6. Doc fixes applied after this review

- `03`: added `object_title`, favorite/pinned semantics, task project-move rule, user-deletion rule.
- `04`: added `object_title`, FTS column order, source_event_seq note, users-never-deleted note.
- `05`: removed generic title updates, unified board route, added `/dashboard`, clarified restore/relogin.
- `10`: chunk replacement strategy, snippet index.
- `12`: FTS skip + reindex after restore, session handling, key fingerprint.
- `13`: pre-migration backup only for non-empty DBs, reset-password script.
- `15`: removed demo-seeding promise; deferred items now have triggers.
- `PLAN.md`: tightened after `PLAN_REVIEW.md`.

## 7. Implementation review (post-build)

Building the specification surfaced four issues that the design review alone could not catch. They are fixed and covered by regression tests:

| Issue | Impact | Fix |
| --- | --- | --- |
| Task update kept a stale `column_id` after moving the task to another project | A task could point at a column owned by its old project | Re-read the task after the project move, reassign the target project's first column, and validate it; regression test added |
| `zod` `.partial()` retained `.default(...)` from create schemas | PATCHing a reference, experiment or AI provider silently reset omitted fields (project, status, models) | Explicit update schemas without defaults; regression assertions added |
| PDF body text was indexed only as chunks, but text search queried only the object FTS table | A PDF's extracted text was not findable in normal search, despite the design promising it | Added the `chunks_fts` virtual table (migration 002) and merged chunk hits into object results with locators |
| Backup and portable export ZIPs did not place entries under a root directory | Extraction littered the target directory and contradicted the documented archive layout | Both writers now prefix every entry with the archive root |

Also hardened during implementation: restore uploads use a 10 GB stream cap while normal attachments still enforce 50 MB, attachment quota is checked before committing, PDF extraction is capped at 40 MB / 2 000 pages, unreferenced blobs get a 24 h GC grace period, and cleanup runs at boot.

**Lessons recorded:** `.partial()` is unsafe with defaults; denormalised columns need re-reads after cross-aggregate moves; any promised search surface must be exercised by an integration test, not just designed.
