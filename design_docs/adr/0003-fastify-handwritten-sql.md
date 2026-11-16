# ADR 0003 — Fastify + hand-written SQL, no ORM

**Status:** Accepted

## Context

The data model uses a supertype table with typed subtables, FTS5 virtual tables, JSON columns and transactionally coupled event/job writes. An ORM would obscure these patterns and add migration tooling we do not control.

## Decision

- Fastify 5 for HTTP, zod for validation, Pino for logs.
- `better-sqlite3` (synchronous, fast, stable) with prepared statements.
- SQL lives only in `modules/*/repo.ts` and `db/`.
- Forward-only SQL migrations in `db/migrations/NNN_name.sql`, checksummed.

## Consequences

- Explicit queries, predictable performance, no N+1 surprises.
- More boilerplate than an ORM; mitigated by small repositories and consistent row mappers.
- Schema changes require hand-written migrations and tests.
- Type safety at the boundary is provided by zod and explicit row types, not by generated models.

## Alternatives rejected

- **Prisma/Drizzle:** migration and runtime overhead, weaker FTS5 support, less control over transactions.
- **Kysely:** good query builder, but still adds a layer for a schema with virtual tables and JSON.
- **Raw `sqlite3`:** no sync API; worse developer experience.

## Addendum (2026-11-16)

The v1 implementation keeps SQL inside each module's `service.ts` rather than creating a `repo.ts` per module. The decision's intent is unchanged: SQL is not in route handlers, another module's SQL is never imported, and a module that grows can split into `repo.ts` without changing its public interface. The boundary checker enforces the cross-module rule.
