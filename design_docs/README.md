# Loom design documentation

Start with **00** if you are new, **16** if you want the critical review of the source design.

| Doc | Contents |
| --- | --- |
| [00 — Overview](00-overview.md) | Vision, principles, scope, glossary, success criteria |
| [01 — Requirements](01-requirements.md) | IDs, priorities, acceptance scenarios, non-functional targets |
| [02 — Architecture](02-architecture.md) | Modular monolith, module catalog, request lifecycle, extension seams, layout |
| [03 — Domain model](03-domain-model.md) | Research objects, entities, invariants, lifecycle, links, IDs |
| [04 — Data model](04-data-model.md) | Tables, indexes, FTS, migrations, transactions, scale assumptions |
| [05 — API design](05-api-design.md) | Conventions, endpoints, errors, SSE contract, versioning |
| [06 — Auth & security](06-auth-security.md) | Threat model, sessions, CSRF, uploads, SSRF, prompt injection, secrets |
| [07 — AI architecture](07-ai-architecture.md) | Providers, ingestion, retrieval, citations, prompts, cost, degraded modes |
| [08 — Events & jobs](08-events-jobs.md) | Activity taxonomy, diffs, durable queue, retries, scheduler |
| [09 — Frontend & UX](09-frontend-ux.md) | IA, layout, tokens, palettes, editor, keyboard, a11y |
| [10 — Search](10-search.md) | FTS5 + chunk FTS, filters, vectors, RRF, performance |
| [11 — Storage](11-storage-files.md) | Content-addressed blobs, PDF extraction, downloads, GC |
| [12 — Export & backup](12-export-backup.md) | Formats, manifest, verification, restore algorithm |
| [13 — Operations](13-ops-observability.md) | Config, data dir, logs, health, deployment, runbooks |
| [14 — Testing](14-testing-quality.md) | Harness, test cases, boundaries check, definition of done |
| [15 — Roadmap & risks](15-roadmap-risks.md) | Phases, deferred features with triggers, risks |
| [16 — Gap analysis](16-gap-analysis.md) | Every missing brick found in the source conversation and its resolution |
| [Review](REVIEW.md) | The documented design review: findings, fixes, residual issues |
| [ADRs](adr/README.md) | 14 architecture decision records |

Implementation plan: [`../PLAN.md`](../PLAN.md) · review: [`../PLAN_REVIEW.md`](../PLAN_REVIEW.md).
