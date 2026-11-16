# ADR 0004 — Universal object supertype + typed subtables

**Status:** Accepted

## Context

The source design's strongest idea is a shared "Research Object" interface. Search, links, tags, activity, export, AI context and breadcrumbs must work uniformly across notes, tasks, references, experiments and questions. But each type has very different fields.

## Decision

Use a physical `objects` table plus 1:1 typed tables (`notes`, `tasks`, `literature`, `experiments`, `questions`):

- Shared columns: id, type, title, project, status, version, favorite, metadata, timestamps, soft delete, actor.
- Typed tables hold detail fields and use the object id as PK/FK.
- An `ObjectTypeDefinition` registry supplies labels, search body, route, exporter and event phrasing.
- Repositories maintain both rows in one transaction; there is no generic update path that bypasses typed validation.

## Consequences

- One query powers cross-type lists, search and the activity feed.
- Slight duplication (title/status mirrored) and a discipline requirement (always write both rows).
- Adding a type = table + registry entry + UI feature, without touching search/links/export cores.
- Polymorphic links and tags are natural.
- Alternative (separate tables with no supertype) would require UNION queries and per-type link tables.

## Invariants

1. Subtype row exists iff object row exists.
2. `objects.version` increments on every aggregate mutation.
3. Deletion is soft; typed row remains until purge.
