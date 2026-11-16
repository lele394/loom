# ADR 0012 — Deterministic fake AI provider

**Status:** Accepted

## Context

AI features are the hardest to test and the easiest to break silently. Network-based tests are flaky, expensive and unavailable offline.

## Decision

Ship a `fake` provider adapter that:

- Streams a deterministic answer built from the injected sources (first two), always citing them.
- Produces deterministic pseudo-embeddings (hash-seeded, fixed dimension) so semantic search and hybrid fusion are testable.
- Supports forced failure modes (`timeout`, `auth`, `rate_limit`, `invalid_json`) via a test-only `extra` flag.
- Can be selected in the UI as "Demo (offline)" for evaluating the app without a model.

Tests use it by default; no test may hit a real provider.

## Consequences

- Chat, citation validation, persistence, RAG wiring and SSE parsing are covered deterministically.
- It does not measure answer quality; real-model evaluation remains manual.
- The fake's embeddings are semantically meaningless; retrieval tests assert *plumbing*, not relevance.
- A demo mode becomes available without shipping model weights.

## Alternatives rejected

- **Mocking fetch globally:** brittle, duplicates adapter logic.
- **Recorded provider fixtures:** large, model-specific, still not deterministic across tokenisers.
- **No AI tests:** unacceptable for citation and persistence correctness.
