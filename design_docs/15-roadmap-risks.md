# 15 — Roadmap, risks and deferred features

## 1. v1 delivery phases

The implementation order is dependency-driven; each phase ends in a demoable state. `PLAN.md` is the executable checklist.

| Phase | Deliverable | Exit criteria |
| --- | --- | --- |
| 0 | Skeleton, config, DB, migrations, auth | Setup/login works; `/readyz` green; tests run |
| 1 | Projects, objects, activity, events | Create project/object; timeline shows every change |
| 2 | Kanban + notes editor | Board moves persist; note autosaves with conflict handling; backlinks |
| 3 | Literature, uploads, extraction | PDF upload → text ready; BibTeX import/export; DOI proposal |
| 4 | Experiments, questions, inbox | Capture → triage → object; experiment with CSV preview |
| 5 | Search + command palette | FTS across all types with snippets and filters |
| 6 | AI: providers, chat, embeddings, RAG | Cited streamed answers; selection scope; fake provider tests |
| 7 | Journal, digests, scheduler | Diff + AI digest, idempotent regeneration, daily schedule |
| 8 | Export, backup, restore, theming, polish | Workspace export; verified backup; restore test; 6 themes; a11y pass |

Phases 0–5 must be usable with AI disabled (product principle).

## 2. Deferred features and the trigger to build them

| Feature | Why deferred | Build when |
| --- | --- | --- |
| Calendar / agenda view | Due dates are enough for the core loop | Users maintain > 10 dated items/week or request milestones |
| Knowledge graph view | Links/backlinks already deliver the value; visualisation is expensive | Backlink panel is used regularly and the graph has > 500 edges |
| AI-discovered connections | Needs embeddings and a scoring/eval design | Retrieval quality is trusted on real data |
| Decision log object type | Another type multiplies UI/export/test surface | User creates "decision" notes repeatedly |
| Meeting notes template | Existing templates cover it | Requested by the user |
| Milestones | Task columns + due dates suffice | Project planning exceeds one board |
| RIS import/export | BibTeX covers the scientific workflow | Zotero/EndNote round-trip is needed |
| Citation styles (APA/MLA) | Not core to capturing research | Writing manuscripts from Loom |
| CSV charting | Attachments + external tools are fine | Comparing experiment runs is routine |
| Rich note embeds (tables/images inline) | Text-first editor ships faster | Notes frequently need tables/figures |
| Offline/PWA sync | Requires CRDT/sync design | Loom is used on a laptop without network |
| Multi-user sharing | Authz policy + UI is a large surface | Collaboration is required |
| Plugin loader | Security/versioning design not worth it yet | Third-party extensions are requested |
| Object-level restore from export | Merge semantics are complex | A user loses one project and needs surgical recovery |
| S3/NAS backup destination | `rsync`/restic is more robust offsite | Managed offsite backup is required |
| Postgres/pgvector | SQLite meets single-user scale | > 50k objects or > 50k chunks |
| Encryption at rest | OS-level encryption is adequate for v1 | Loom is deployed on shared hardware |
| Dynamic dashboard widgets | Fixed grid covers the morning review | Users rearrange widgets weekly |

## 3. Risks

| Risk | Likelihood | Impact | Mitigation | Early signal |
| --- | --- | --- | --- | --- |
| Scope explosion (build the whole vision) | High | v1 never ships | Phased plan, explicit non-goals, "works without AI" gate | Phase slipping > 1 week |
| Editor complexity | High | Blocks polish, causes data loss | Text-first blocks, no CRDT, version conflict UX, tests | Autosave conflicts in manual QA |
| SQLite write contention | Medium | UI stalls during PDF jobs | Single worker, short transactions, WAL | p95 latency > 300 ms |
| Vector search scale | Medium | Slow semantic search | Cap + status warning; sqlite-vec seam | > 10k chunks |
| AI quality/hallucination | High | Trust erosion | Diff-first journal, citation validation, refusal rules, eval checklist | Unsourced answers |
| Prompt injection | Medium | Data exfiltration via model output | No tools, untrusted delimiters, escaped rendering, no outbound from content | Suspicious output in eval |
| Backup untested | Medium | Data loss | Restore tests, automatic verification, quarterly runbook | Failed verify |
| Dependency churn (React/Vite/Fastify majors) | Medium | Build breakage | Lockfile, small dependency set, pinned majors | CI failures after install |
| Theming contrast regressions | Medium | Unreadable UI | Token system, AA targets, manual palette pass | Contrast check fails |
| Over-abstraction | Medium | Slow development | Registries only where they pay off; hand-written SQL | Many one-implementation interfaces |
| PDF extraction failures | Medium | Papers unsearchable | Status + retry, abstract/manual notes remain | `text_status=failed` rate |
| Single maintainer bus factor | High | Project abandonment | Docs, ADRs, tests, boring stack | — |

## 4. Milestones (product-level)

- **M1 — Notebook.** Projects, notes, board, activity, themes. Usable daily without AI.
- **M2 — Library.** Literature, PDFs, BibTeX, experiments, questions, inbox, search.
- **M3 — Assistant.** Providers, chat with citations, embeddings, hybrid search.
- **M4 — Memory.** Journal, diffs, digests, timeline.
- **M5 — Ownership.** Export, backup, restore, packaging.

## 5. Success metrics (personal, not analytics)

No telemetry is collected. The user can judge v1 by:

- Time from opening Loom to capturing a thought < 3 s.
- Time to find a known paper < 10 s.
- Zero lost edits across a week of use.
- One successful restore drill per quarter.
- The daily digest is worth reading (subjective, but the diff must be exact).

## 6. Post-v1 candidates in likely order

1. Real-model retrieval tuning + reranking.
2. sqlite-vec when chunk count warrants it.
3. Note image/table blocks.
4. Calendar/agenda and milestones.
5. Decision log and meeting notes.
6. Object-level export/import.
7. OIDC and project sharing.
8. Plugin registries → dynamic plugins.
9. Knowledge graph visualisation.
10. AI connections with an evaluation harness.
