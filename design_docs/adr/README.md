# Architecture Decision Records

Short, immutable records of the decisions that would be expensive to reverse. Format: context → decision → consequences → alternatives.

| ADR | Decision |
| --- | --- |
| [0001](0001-typescript-monolith.md) | TypeScript modular monolith |
| [0002](0002-sqlite-primary-store.md) | SQLite as the system of record |
| [0003](0003-fastify-handwritten-sql.md) | Fastify + hand-written SQL, no ORM |
| [0004](0004-object-supertypes.md) | Universal object supertype + typed subtables |
| [0005](0005-db-backed-jobs.md) | Database-backed jobs, no Redis/outbox |
| [0006](0006-ai-provider-port.md) | AI provider port with capability flags |
| [0007](0007-local-session-auth.md) | Local session auth with scrypt + CSRF |
| [0008](0008-block-notes-optimistic.md) | JSON block notes with optimistic concurrency |
| [0009](0009-css-tokens-no-tailwind.md) | CSS design tokens instead of Tailwind |
| [0010](0010-backup-format.md) | Versioned SQLite backup + ZIP manifest |
| [0011](0011-hybrid-search-rrf.md) | FTS5 + optional vectors fused with RRF |
| [0012](0012-fake-ai-provider.md) | Deterministic fake provider for tests and demo |
| [0013](0013-single-project-membership.md) | One home project + cross-project links |
| [0014](0014-digest-diff-first.md) | Deterministic diff before LLM interpretation |

New decisions append a numbered ADR; do not rewrite history. If a decision changes, add a superseding ADR that references the old one.
