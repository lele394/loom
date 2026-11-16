# ADR 0013 — One home project plus cross-project links

**Status:** Accepted

## Context

The source design says projects are logical containers (one database) and asks for a reference to belong to multiple projects. The second point suggests a many-to-many association, but the first argues against duplicating records.

## Decision

- Every object has exactly one optional home project (`objects.project_id`; null = global/unfiled).
- Cross-project relevance is expressed with typed links between objects in different projects.
- Literature can also live in the global collection.
- The UI shows "linked in N other projects" rather than multi-membership.
- No `object_projects` join table in v1.

## Consequences

- Queries, permissions, deletion and the UI stay simple.
- Sharing a paper across projects is a link, not membership; filtering a project's library does not include papers from other projects unless they are linked. A "linked literature" section covers this.
- If true multi-project membership is later required, add `object_projects` and migrate `project_id` into it; links remain valid.

## Alternatives rejected

- **Many-to-many membership:** every list/filter needs a join and "which project owns this?" UI ambiguity; duplicate-free but complexity-heavy for v1.
- **Duplicating references per project:** the exact problem the source design warned against.
