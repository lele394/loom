# ADR 0005 — Database-backed jobs, no Redis and no outbox

**Status:** Accepted

## Context

Loom needs background work: PDF extraction, embeddings, digest generation, backups, pruning. The source design proposed Redis + Celery/ARQ. Separately, event logging and job enqueue must be consistent with the state change that caused them.

## Decision

- A `jobs` table in the same SQLite database.
- Producers enqueue inside the domain transaction.
- One in-process worker with a `JobHandler` registry, leases via status transitions, exponential backoff and dead-letter visibility.
- On startup, `running` jobs are requeued (single-process assumption).
- The scheduler enqueues date-scoped jobs with unique idempotency keys.

No outbox table: an outbox exists to bridge a DB transaction and an *external* broker; here the queue is in the transaction's database.

## Consequences

- Atomicity by construction; no dual-write bug class.
- No extra service, no credentials, no network failure mode.
- Single worker concurrency; long jobs delay others. Mitigated by priorities and short work units.
- Not horizontally scalable; accepted.
- If an external queue is ever needed, `jobs` becomes an adapter and handlers stay unchanged.

## Alternatives rejected

- **BullMQ/Redis:** operational dependency and duplicate state.
- **setTimeout in request handlers:** lost on restart, no retries/visibility.
- **Outbox + poller:** unnecessary indirection when producer and queue share a database.
