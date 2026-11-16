# ADR 0002 — SQLite as the system of record

**Status:** Accepted

## Context

The source design chose PostgreSQL + pgvector. Loom is single-user, runs on a laptop or home server, and must be trivially backable-up and movable. A personal notebook has tens of thousands of rows, not millions of concurrent users.

## Decision

Use SQLite in WAL mode as the only database:

- State, activity events, jobs, settings and AI conversations.
- FTS5 for full-text search.
- Embeddings as BLOBs with in-process cosine similarity.
- Online backup via `db.backup()`.

Repository classes and `VectorIndex`/`BlobStore` ports isolate SQL and retrieval so Postgres/pgvector or sqlite-vec can replace them.

## Consequences

- One file to back up; zero services to operate; fast local reads; transactions are simple.
- Single writer: jobs run with concurrency 1 and transactions stay short.
- Brute-force vector scan is viable to ~50k chunks; beyond that an ANN index is required.
- No built-in multi-node deployment; accepted (single instance).
- JSON1 is available for metadata queries; FTS5 is compiled into the standard SQLite used by better-sqlite3.

## Alternatives rejected

- **Postgres:** operational cost and backup complexity without scale benefit.
- **DuckDB:** analytical, not transactional OLTP with concurrent readers/writers.
- **JSON files:** no transactions, no indexes, corruption risk.
