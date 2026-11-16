# 10 — Search and retrieval

One search box, two engines, one ranking pipeline. Text search always works; semantic search improves it when embeddings exist.

---

## 1. Index contents

| Index | Rows | Text |
| --- | --- | --- |
| `search_fts` | one per object | title, composed body, tag names |
| `chunks_fts` | one per chunk | chunk text; makes PDFs and long notes searchable |
| `chunks` + embeddings | many per object | retrievable segments with locators |

**Composed body per type** (registry-driven):

| Type | Body |
| --- | --- |
| note | plain text of all blocks + template |
| task | description + checklist text + column name |
| reference | authors, venue, year, abstract, notes, extra fields |
| experiment | objective, hypothesis, method, results, metrics names |
| question | question + context + status |

Attachments' extracted text is **not** in `search_fts` (it would make object-level FTS huge); it is indexed in `chunks_fts`, and chunk hits map back to their object. PDF chunks carry a page locator; archived web pages carry an attachment locator. The object-level FTS still ensures a paper with a matching title/abstract ranks even without extraction.

## 2. Index lifecycle

- **Created/updated:** the search service recomputes the FTS row and **deletes all chunks for the object before re-inserting** inside the mutation transaction. This guarantees that a saved note is searchable immediately and that stale chunks cannot accumulate.
- **Deleted:** soft delete removes the FTS row and marks chunks (they are deleted with the object row on purge). Search joins `objects` and filters `deleted_at IS NULL`, so stale FTS rows are harmless but are still cleaned.
- **Purged:** FK cascade removes chunks; the search service deletes the FTS row explicitly (FTS has no FK).
- **Embeddings:** filled by `embed.chunks` jobs. Stale embeddings (different model/dim) are ignored at query time and re-embedded.
- **Rebuild:** `POST /search/reindex` enqueues a job that iterates objects in batches of 200, rebuilds FTS and chunks, and (if configured) enqueues embedding jobs. Progress is visible in Settings → Jobs.
- **Consistency check:** a maintenance query counts objects without FTS rows and chunks without embeddings; shown in search status.

## 3. Text search

### Query building

```
input → trim, lowercase for matching map
     → tokenize on whitespace/punctuation
     → drop tokens > 64 chars, keep max 12
     → quote each token with double quotes (escape embedded quotes)
     → join with OR; append '*' to the last token for prefix matching
```

User-supplied FTS operators (`AND`, `OR`, `NOT`, `NEAR`, `*`, `"`) are escaped, never interpreted. Empty query → no FTS, return recents filtered.

Chunk text (PDF pages, note blocks) is searched through `chunks_fts`, which is merged after object-level hits. Chunk hits are deduplicated by object and carry a `locator` (page/block). This is what makes PDF body text findable without inflating `search_fts`:

```sql
SELECT chunks_fts.object_id, ...,
       bm25(chunks_fts, 1.0) AS score,
       snippet(chunks_fts, 0, '«', '»', '…', 18) AS snippet,
       c.locator_json
FROM chunks_fts
JOIN chunks c ON c.id = chunks_fts.chunk_id
JOIN objects o ON o.id = chunks_fts.object_id
WHERE chunks_fts MATCH ? AND o.deleted_at IS NULL
ORDER BY score ASC
LIMIT ?;
```

### Statement (shape)

```sql
SELECT o.id, o.type, o.title, o.project_id, o.updated_at,
       bm25(search_fts, 8.0, 1.0, 3.0) AS score,
       snippet(search_fts, 1, '«', '»', '…', 14) AS snippet
FROM search_fts f
JOIN objects o ON o.id = f.object_id
WHERE search_fts MATCH ?
  AND o.deleted_at IS NULL
  AND (? IS NULL OR o.type = ?)
  AND (? IS NULL OR o.project_id = ?)
ORDER BY score ASC, o.updated_at DESC
LIMIT ?;
```

- Weights: title 8, tags 3, body 1. Lower `bm25` is better.
- Tag filter uses `EXISTS (SELECT 1 FROM object_tags ot JOIN tags t … WHERE t.name = ?)`.
- Date filters use `o.updated_at` (or `literature.added_at` for type=reference, via join).
- Snippets are plain text with `«»` markers; the client escapes and converts markers to `<mark>`.

### Optional ranking adjustments

- Exact title match (case-insensitive) is boosted by ordering it first.
- Recency tiebreak.
- Type boosting is a UI concern (filter chips), not baked into scores, so users see why results appear.

## 4. Semantic search

- Query embedded with the configured embedding model. No model → semantic mode returns `503 semantic_unavailable` and the UI falls back to text.
- Candidate scan: chunks for non-deleted objects, filtered by project/type/tags (SQL join), limited to the most recent 50 000 chunks if the corpus is larger (configurable). Cosine similarity computed in JS over `Float32Array`.
- Minimum similarity 0.2 (model-dependent; configurable in settings later). Results aggregated by object (max chunk score, up to 2 chunks for display).
- Each result exposes the best chunk's excerpt and locator, enabling "jump to page/block".
- Embedding model is part of the query: only chunks with the active model are compared.

## 5. Hybrid fusion

Reciprocal Rank Fusion:

```
score(d) = Σ_r 1 / (60 + rank_r(d))
```

- Run text and semantic retrieval independently (top 50 each), fuse by object ID.
- Boost objects appearing in both lists (implicit in RRF).
- Optional rerank: top 30 fused results are sent to `rerankModel` with the query; final top N uses reranker scores. Reranker failure logs and falls back to fused order (never fails the search).
- If only one engine is available, hybrid degrades to that engine and reports which was used in the response (`engines: ["text"]`).

## 6. Response contract

```json
{
  "query": "energy counters",
  "mode": "hybrid",
  "engines": ["text", "semantic"],
  "tookMs": 84,
  "results": [{
    "objectId": "ref_01…",
    "type": "reference",
    "title": "Energy-Efficient …",
    "projectId": "prj_01…",
    "projectName": "HPC",
    "snippet": "…hardware performance counters were used to…",
    "score": 0.041,
    "updatedAt": "2026-11-14T…",
    "locator": { "page": 4 }
  }],
  "total": 12,
  "semanticAvailable": true
}
```

Text-only results omit `locator`. `total` is the count after filters, capped at 200.

## 7. Filters

`type` (repeatable), `projectId`, `tag` (repeatable, AND), `from`/`to` (updated date), `readingStatus` (reference), `taskStatus`, `ideaOnly` no. Filters translate to SQL joins to the typed table only when needed, keeping the common path fast.

## 8. Performance

- FTS5 query at 50k objects: < 20 ms typical.
- Snippet generation included in the query (~5 ms).
- Chunk vector scan at 50k × 768 dims: ~250 ms in JS. Above 10k chunks, the UI shows "semantic search may take a moment"; above 50k, Settings recommends an index upgrade.
- Embedding jobs batch 32 chunks per request.
- Index writes add < 5 ms to a typical save.

## 9. Failure modes

| Failure | Behaviour |
| --- | --- |
| FTS table missing/corrupt | `/readyz` reports; reindex job repair; search returns 500 with `index_unavailable` |
| Embedding provider down | text search works; semantic returns error; status banner; jobs retry |
| Mixed embedding models | only active-model chunks are searched; coverage shown |
| Query too long | truncated to 12 tokens / 512 chars, noted in response |
| No results | empty state with "search inside attachments is only available after extraction" hint |

## 10. Retrieval API for AI

`search.retrieve({query, scope, projectId, objectIds, types, limit})` returns chunks with object metadata and locators. It is the only entry point used by RAG, guaranteeing that AI retrieval respects the same filters, deletion state and model selection as the UI.

## 11. Future

- sqlite-vec / pgvector for ANN search (port already exists).
- Query embeddings cache (avoid re-embedding identical follow-up queries).
- Saved searches, result grouping by project, "find similar" from an object.
- Cross-encoder reranking as a local model.
