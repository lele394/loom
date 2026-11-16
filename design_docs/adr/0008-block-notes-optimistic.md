# ADR 0008 — JSON block notes with optimistic concurrency

**Status:** Accepted

## Context

Notes are the core surface. The source design asks for typed blocks with stable IDs, version history and linking. Real-time collaboration is not required. A CRDT or a rich-text framework would add substantial complexity and risk.

## Decision

- Canonical document: `blocks_json` = ordered `Block[]`, each with a stable `blk_` id, type, text and optional meta.
- The editor is text-first: each block is a textarea rendered as Markdown when unfocused.
- One block = one chunk with `locator.blockId` for search and citations.
- Saving is a full-document PUT with `expectedVersion` (from `objects.version`).
- Conflicts return 409; the client keeps the draft and offers reload or force-overwrite (which snapshots first).
- Version snapshots (last 50 / 90 days) are stored on save (throttled) and on restore.
- Markdown is the export/interchange format, not the storage format.

## Consequences

- Simple, debuggable, testable; no editor framework lock-in.
- Full-document saves are fine at ≤ 2k blocks; huge documents would need patches.
- No live co-editing; single-user assumption, conflict-safe multi-tab.
- Rich embeds (tables/images) require schema evolution of `meta` and renderer work.

## Alternatives rejected

- **ProseMirror/TipTap JSON:** heavier dependency, schema migrations inside documents, still no collaboration without a backend.
- **Yjs CRDT:** powerful but introduces sync protocol, persistence and compaction for a single-user app.
- **Plain textarea:** no block-level citation anchors or type-aware search.
