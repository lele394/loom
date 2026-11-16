# 08 — Activity events, jobs and scheduling

Two independent mechanisms keep history and background work correct:

1. **Activity events** — append-only, user-facing, written in the same transaction as the change.
2. **Jobs** — durable, retryable background work, enqueued in the same transaction as the change.

Both live in SQLite. There is no external broker and no outbox table: the transactional guarantee comes from writing the job row in the same transaction as the domain row. This is simpler than an outbox for a single-database deployment and is documented as ADR 0005.

---

## 1. Activity log

### Recording

Every mutating service calls:

```ts
activity.record(tx, {
  actorId, projectId, objectId, objectType, objectTitle,
  action: 'note.updated',
  summary: 'Updated note "Frequency scaling observations"',
  changes: { blocks: { from: 12, to: 15 } },   // structured, small
  source: 'ui' | 'api' | 'job' | 'ai',
  requestId,
})
```

Rules:
- Called inside the same transaction, after the state write succeeds.
- `summary` is generated server-side from typed data; never by an LLM and never from raw user HTML.
- `changes` stores only small diffs (field names and short old/new values); full note bodies are in `note_versions`, not events.
- `project_id` is the object's project at the time of the event. Moving an object emits both the update and the new project.
- Delete/restore emit events. Purge does not erase past events.
- Attachments, tags and links emit events on the parent object (`reference.attachment_added`, `task.linked`).

### Action taxonomy

| Domain | Actions |
| --- | --- |
| Object | `object.created`, `object.updated`, `object.deleted`, `object.restored`, `object.moved`, `object.favorited`, `object.tagged` |
| Note | `note.saved`, `note.version_restored`, `note.pinned` |
| Task | `task.created`, `task.updated`, `task.moved`, `task.completed`, `task.reopened`, `task.deleted` |
| Reference | `reference.created`, `reference.updated`, `reference.status_changed`, `reference.attachment_added`, `reference.doi_detected`, `reference.url_ingested` |
| Experiment | `experiment.created`, `experiment.updated`, `experiment.status_changed`, `experiment.result_recorded` |
| Question | `question.created`, `question.status_changed`, `question.answered` |
| Inbox | `inbox.captured`, `inbox.triaged`, `inbox.archived`, `inbox.deleted` |
| Link | `link.created`, `link.removed` |
| Project | `project.created`, `project.updated`, `project.archived`, `project.unarchived`, `project.deleted`, `project.restored` |
| Import/export | `data.imported`, `data.exported`, `backup.created`, `backup.restored` |

AI conversations do not write activity events (they would drown the feed); converting a message to a note/task emits `note.created`/`task.created` with source `ai`.

### Daily diff

`activity.diff(date, timezone)`:

1. Convert local date to UTC `[start, end)` using the user's IANA timezone (DST-safe via `Intl`/date library).
2. Select events in range. Group by `project_id` (null → "Unfiled").
3. Classify each object's events with precedence: **removed > created > completed > updated**. One entry per object per bucket, carrying the latest title and changed field names.
4. Count events, compute `eventSeqRange`.
5. Return `DailyDiff` (schema in `03-domain-model.md §2`).

Determinism requirements: stable ordering (title, id), no `now()` in the payload, no LLM. Golden tests cover empty days, timezone edges and mixed event sets.

## 2. Job queue

### Lifecycle

```
queued ──claim──▶ running ──success──▶ succeeded
   ▲                 │
   │                 ├─ retryable error & attempts < max ──▶ queued (run_at = now + backoff)
   │                 └─ attempts >= max ──▶ dead
   └── manual retry from dead/failed
```

Statuses: `queued`, `running`, `succeeded`, `failed` (non-retryable), `dead` (retries exhausted). `failed` and `dead` are visible in Settings → Jobs with the error.

### Enqueue

```ts
jobs.enqueue(tx, {
  type: 'embed.chunks',
  payload: { objectId },
  idempotencyKey: `embed:${objectId}:${version}`,
  priority: 100,
  maxAttempts: 4,
})
```

- `idempotencyKey` is unique; a duplicate enqueue is a no-op. This is how producer debouncing works (typing autosaves enqueue only one index job per version).
- Payload is JSON and must be self-contained (IDs, not objects).
- Jobs enqueued inside a transaction become visible only after commit — correct by construction.

### Execution

- Claim query (single process):

```sql
UPDATE jobs SET status='running', started_at=?, attempts=attempts+1
WHERE id = (
  SELECT id FROM jobs
  WHERE status='queued' AND run_at <= ?
  ORDER BY priority ASC, run_at ASC, created_at ASC
  LIMIT 1
)
RETURNING *;
```

- Poll interval 1 s when idle, immediate when a job is enqueued. Concurrency 1 for v1 (prevents SQLite write contention and memory spikes); per-type concurrency can be added.
- Timeout per job type: extraction 120 s, embeddings 120 s, digest 180 s, reference summary/extraction 240 s, backup 600 s, others 60 s. A timeout aborts the handler and counts as a failed attempt.
- On startup, any `running` rows are returned to `queued` (single-process assumption; documented).
- Graceful shutdown waits up to 10 s for the current job, then requeues it.
- Retryable: network errors, provider 429/5xx, timeouts, SQLITE_BUSY. Non-retryable: validation errors, missing object, unsupported file, auth errors.
- Backoff: `min(30s * 2^(attempt-1), 30min) + jitter(0–5s)`. Max attempts default 3 (embeddings 5).
- Jobs never run inside a request transaction. Handlers open their own short transactions.

### Handler registry

| Type | Payload | Work | Retry |
| --- | --- | --- | --- |
| `index.object` | `{objectId}` | Rebuild FTS doc + chunks for one object | yes |
| `embed.chunks` | `{objectId?}` | Embed chunks missing vectors for current model | yes |
| `extract.attachment` | `{attachmentId}` | PDF/CSV text extraction, page map, DOI detect, then index link | yes |
| `reference.enrich` | `{referenceId}` | Crossref metadata by DOI | yes |
| `reference.summarize` | `{referenceId,mode?,instructions?}` | AI summary, stored separately from notes | yes |
| `reference.reextract` | `{referenceId,mode?,title,actorId}` | Re-run metadata extraction and apply the validated result | yes |
| `digest.generate` | `{userId,date,force?}` | Compute diff, call AI if available, upsert digest | yes |
| `backup.create` | `{kind}` | Snapshot + zip + verify + prune | yes |
| `backup.verify` | `{backupId}` | Checksums + integrity check | no |
| `backup.prune` | `{}` | Retention cleanup | no |
| `search.reindex` | `{scope}` | Rebuild all chunks/FTS | yes |
| `trash.purge` | `{}` | Hard-delete objects past retention | no |
| `sessions.prune` | `{}` | Delete expired sessions | no |
| `attachment.gc` | `{}` | Remove unreferenced blobs | no |

A handler returns `void` or throws. It must be **idempotent** because a crash after side effects but before marking `succeeded` will replay it. Side effects are keyed by object version or by content hash.

## 3. Scheduler

A single 60-second ticker in the worker process checks due schedules. Every schedule enqueues a job with a date-scoped idempotency key, so ticks are naturally idempotent and restarts do not duplicate work.

| Schedule | Default | Key |
| --- | --- | --- |
| Daily digest (yesterday) | 06:00 local, configurable | `digest:{userId}:{date}` |
| Daily backup | 03:00 local | `backup:auto:{date}` — only if none succeeded that day |
| Backup pruning | after each backup | — |
| Session pruning | hourly | `sessions:{yyyy-mm-dd-hh}` |
| Trash purge | daily 04:00 | `trash:{date}` |
| Full reindex | manual only | — |

Schedules are computed in the user's timezone. If the server was off at the scheduled time, the tick on startup sees that today's key is unused and enqueues immediately (catch-up). Digest `force` is off: if a digest for yesterday already exists, the job is a no-op unless events are newer than `source_event_seq`.

## 4. Observability

- `GET /jobs` lists queued/running/dead with type, attempts, error, timestamps.
- Feature queues (metadata re-extraction) read their own type via `GET /references/extraction-jobs`, which merges active jobs with the last 24 h of finished ones. `dismissed_at` hides a finished job from that queue without deleting the operational history from Settings → Jobs.
- Browser-side PDF uploads are not jobs: files waiting in the drop queue are persisted in IndexedDB so a reload can resume queued uploads. An upload interrupted mid-flight is shown as failed with a Retry action rather than being silently replayed, which avoids duplicate references.
- Worker logs one line per job start/finish/failure with `jobId`, `type`, duration.
- `GET /healthz` includes queue depth and oldest queued age; `readyz` fails if the DB is unwritable or migrations are pending.
- Job telemetry counters (processed/failed by type) are kept in memory and exposed in `/meta` (P1).

## 5. Why not an outbox or external queue

- **Outbox** exists to bridge a database transaction and an external broker. Here the queue *is* in the database, so the enqueue is already atomic.
- **Redis/Celery/BullMQ** would add a service, another failure domain, and duplicate state. A single user does not need distributed throughput.
- **Trade-off:** jobs do not survive a lost database volume (neither does anything else), and horizontal scaling is impossible. Both are acceptable and documented; the `JobHandler` registry makes an external queue an adapter-level change if needed.
