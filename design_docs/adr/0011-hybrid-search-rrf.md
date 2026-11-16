# ADR 0011 — FTS5 + optional vectors, fused with RRF

**Status:** Accepted

## Context

The source design correctly rejects embeddings-only retrieval and asks for hybrid search. Exact keyword search matters for symbols, author names, DOIs and code identifiers; semantic search matters for paraphrase and concepts.

## Decision

- FTS5 is always on. Ranking uses BM25 with weights title 8, tags 3, body 1.
- Chunks are the semantic unit; embeddings are optional and model-tagged.
- Hybrid = RRF over text and vector rankings, `k=60`, then optional rerank of the top 30.
- Retrieval returns chunks with object metadata and locators; the same function powers UI search and AI context.
- Vector scan is brute force in JS with a documented 50k-chunk cap; `VectorIndex` is a port for sqlite-vec/pgvector.

## Consequences

- Search works with zero AI configuration.
- Fusion is rank-based, so calibrating scores between engines is unnecessary.
- RRF can under-weight excellent single-engine results; mitigated by exact-title boosting and per-engine result inclusion.
- Vector scan CPU cost is the known scaling limit.

## Alternatives rejected

- **Embeddings only:** misses exact identifiers and fails without a provider.
- **Weighted score sum:** requires score normalisation that varies per corpus.
- **BM25 only:** fails the "find papers about X" semantic use case.
