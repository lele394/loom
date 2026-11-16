# ADR 0001 — TypeScript modular monolith

**Status:** Accepted (2026-11-16)

## Context

Loom is a single-user research OS with a rich browser UI, background processing, PDF extraction, search and AI. The source design proposed React + FastAPI + PostgreSQL + Redis. That means two languages, two dependency ecosystems, two deployment units and duplicated types.

## Decision

Build the entire application in TypeScript:

- Node.js 24 server (Fastify), run with `tsx`.
- React 19 SPA built by Vite.
- Shared domain types and zod schemas under `src/shared`.
- One process serves API, static assets and runs jobs.

## Consequences

- One toolchain, one lockfile, one deploy step, shared validation.
- The worker shares the event loop with HTTP; CPU-heavy work must not block it (PDF extraction is async; zip creation is the watch item).
- No Python ecosystem for scientific libraries. Loom is not a compute platform; experiments link to external analysis.
- Hiring/contribution is easier for a web developer, harder for a Python researcher. Acceptable for a personal tool.

## Alternatives rejected

- **FastAPI + React:** operational and type duplication, no user-visible benefit at this scale.
- **Single-language Python (NiceGUI/HTMX):** weaker component ecosystem for the editor, board and AI panel.
- **Next.js full-stack:** server components and routing add complexity; SSE + long jobs fit a plain Fastify server better.
