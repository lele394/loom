# 05 — HTTP API design

Base path: `/api/v1`. Content type: `application/json` (except uploads/downloads/SSE). The SPA is served from `/`, API from `/api/v1`.

The API is the only integration surface. There is no GraphQL, no RPC-over-websocket, no public plugin API in v1.

---

## 1. Conventions

- **Naming:** camelCase JSON fields; path resources are plural kebab-free (`/references`, `/board-columns`).
- **IDs:** opaque, prefixed ULIDs.
- **Timestamps:** ISO-8601 UTC strings. Date-only fields are `YYYY-MM-DD`.
- **Auth:** session cookie. Unauthenticated API requests get `401 unauthenticated`. The SPA redirects to `/login`.
- **CSRF:** every `POST/PUT/PATCH/DELETE` must send `X-CSRF-Token` matching the session's token. The token is returned by `GET /auth/session` and embedded in a readable cookie at login. Origin is additionally checked against the request host.
- **Idempotency:** job-producing endpoints (`digest`, `backup`, `reindex`, `ingest`) derive an idempotency key server-side where possible. Client-supplied `Idempotency-Key` is accepted on `POST /inbox` and `POST /ai/conversations/:id/messages` (cached 24 h, same response replayed).
- **Concurrency:** mutable resources expose `version`. Update endpoints accept `expectedVersion`. On mismatch: `409 version_conflict` with `details.currentVersion`. `force: true` is accepted only on notes and backing up the previous state first.
- **Pagination:** list endpoints accept `limit` (default 30, max 200) and `offset` (max 10 000). Chronological feeds (activity, messages) use `before` (exclusive seq/timestamp) instead of offset. Cursors are opaque when present.
- **Sorting:** `sort=updated|created|title|due` where supported. Defaults documented per endpoint.
- **Filtering:** scalar query params; repeated `tag` params allowed (AND semantics); `type` may repeat.
- **Errors:** one envelope, stable machine codes, no stack traces.

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Request body is invalid.",
    "details": [{ "path": "title", "message": "Required" }],
    "requestId": "req_01JB…"
  }
}
```

### Error codes

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `validation_failed` | zod validation |
| 400 | `bad_request` | malformed/missing parameter |
| 401 | `unauthenticated` | no/expired session |
| 403 | `forbidden` | authenticated but not allowed |
| 403 | `csrf_invalid` | missing/bad CSRF token |
| 404 | `not_found` | object/route missing (or soft-deleted) |
| 409 | `version_conflict` | optimistic concurrency |
| 409 | `duplicate` | unique conflict (cite key, tag, username) |
| 409 | `setup_complete` | setup attempted after account exists |
| 413 | `payload_too_large` | upload/size limit |
| 422 | `unsupported_file` | MIME/sniff rejected |
| 423 | `project_archived` | write into archived project |
| 429 | `rate_limited` | login/general limits |
| 500 | `internal_error` | unexpected |
| 502 | `provider_error` | AI upstream failure |
| 503 | `ai_unavailable` | no provider/embeddings configured |
| 504 | `provider_timeout` | AI upstream timeout |

## 2. Endpoint catalogue

Legend: 🔓 public bootstrap, 🔐 authenticated. All mutations require CSRF.

### Bootstrap and auth

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/auth/session` | 🔓 Current user + CSRF token + `setupRequired` + capabilities |
| POST | `/auth/setup` | 🔓 One-time account creation; body `{username,password,displayName?,timezone?,starterProject?}` |
| POST | `/auth/login` | Body `{username,password}`; rotates session |
| POST | `/auth/logout` | 🔐 Destroys current session |
| POST | `/auth/logout-all` | 🔐 Destroys all sessions |
| POST | `/auth/password` | 🔐 `{currentPassword,newPassword}` |
| GET | `/meta` | App version, capabilities, limits, storage usage |

### Projects

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/projects?includeArchived=1` | List with counts |
| POST | `/projects` | `{name,description?,color?}`; creates default columns |
| GET | `/projects/:id` | |
| PATCH | `/projects/:id` | name/description/color |
| DELETE | `/projects/:id` | soft delete + cascade to objects |
| POST | `/projects/:id/restore` | restore project and its trashed objects |
| POST | `/projects/:id/archive` | `{archived:boolean}` |
| GET | `/projects/:id/overview` | counts, recent activity, today's tasks, open questions |
| GET | `/dashboard` | single aggregation: project summaries, due tasks, inbox count, recent activity, yesterday's digest |
| GET | `/projects/:id/columns` | |
| POST | `/projects/:id/columns` | `{name,isDone?}` |
| PATCH | `/board-columns/:id` | rename, reorder (`position`), set done |
| DELETE | `/board-columns/:id` | rejected if it holds tasks (409) |

### Objects, tags, links

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/objects` | filters: `type`, `projectId`, `tag`, `favorite`, `status`, `q`, `limit`, `offset` |
| GET | `/objects/:id` | Universal envelope: `{object, data, tags, links, backlinks, attachments}` |
| PATCH | `/objects/:id` | `{favorite?, projectId?}` — titles change only through typed endpoints |
| DELETE | `/objects/:id` | soft delete |
| POST | `/objects/:id/restore` | |
| GET | `/objects/:id/links` | outgoing |
| POST | `/objects/:id/links` | `{targetId, kind?, anchor?}` |
| DELETE | `/links/:id` | soft delete |
| PUT | `/objects/:id/tags` | `{tagIds:string[]}` full replacement |
| GET | `/tags` | counts included |
| POST | `/tags` | `{name,color?}` — idempotent by name |
| PATCH | `/tags/:id` | rename/recolour |
| DELETE | `/tags/:id` | removes associations |

### Notes

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/notes?projectId&template&pinned&q&limit&offset` | |
| POST | `/notes` | `{title?,template?,projectId?,blocks?}`; template populates blocks |
| GET | `/notes/:id` | includes `version`, `blocks`, `warnings[]` |
| PUT | `/notes/:id` | `{title?,blocks,expectedVersion?,force?}` — returns new version |
| DELETE | `/notes/:id` | |
| GET | `/notes/:id/versions` | metadata list |
| GET | `/notes/:id/versions/:version` | full snapshot |
| POST | `/notes/:id/versions/:version/restore` | creates a new version from snapshot |
| GET | `/notes/:id/markdown` | `text/markdown` download |

### Tasks and board

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/tasks?projectId&columnId&priority&due=overdue|today|week&q` | |
| POST | `/tasks` | `{title,projectId,columnId?,description?,priority?,dueDate?,...}` |
| GET | `/tasks/:id` | |
| PATCH | `/tasks/:id` | partial; completion derived from column |
| POST | `/tasks/:id/move` | `{columnId,position}` — dense reorder in one transaction |
| POST | `/tasks/:id/complete` | `{done:boolean}` |
| DELETE | `/tasks/:id` | |
| GET | `/projects/:id/board` | columns + ordered tasks + counts |

### Literature and attachments

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/references?projectId&q&readingStatus&year&tag&limit&offset` | |
| POST | `/references` | manual metadata; `citeKey` auto-generated if absent |
| GET | `/references/:id` | |
| PATCH | `/references/:id` | |
| DELETE | `/references/:id` | |
| POST | `/references/ingest-url` | `{url,projectId?,pdfMode?}` — SSRF-guarded fetch, HTML archive, AI metadata, creates reference |
| POST | `/references/ingest-urls` | `{urls[1..10],projectId?,pdfMode?}` — batch, partial success with per-URL errors |
| POST | `/references/ingest-pdf?projectId&mode=text\|images\|ocr` | multipart `file` — PDF extraction/AI metadata, creates reference + attachment |
| POST | `/references/import-bibtex` | `{bibtex,projectId?}` — returns `{created,skipped,errors[]}` |
| GET | `/references.bib?projectId&ids` | `application/x-bibtex` |
| POST | `/references/:id/pdf` | multipart `file`; max size enforced |
| POST | `/references/:id/enrich` | Crossref lookup by DOI (P1) |
| POST | `/references/:id/summarize` | `{mode?,instructions?}` → 202 job; summary stored separately from notes |
| GET | `/references/:id/bookmarks` | page bookmarks |
| POST | `/references/:id/bookmarks` | `{page,note?}`; note ≤250 chars |
| PATCH | `/bookmarks/:id` | update page/note |
| DELETE | `/bookmarks/:id` | |
| GET | `/jobs/:id` | job status for summary polling |
| POST | `/references/:id/reextract-metadata` | `{source?,mode?,apply?}` — returns raw output + parsed metadata; `apply:true` also applies it |
| POST | `/references/reextract-metadata` | `{items:[{id,mode?}]}` → 202; enqueues durable `reference.reextract` jobs |
| GET | `/references/extraction-jobs` | active + last-24h finished metadata jobs for the queue UI |
| POST | `/references/extraction-jobs/dismiss` | dismiss finished extraction jobs from the queue (keeps job history) |
| POST | `/objects/:id/attachments` | generic multipart upload |
| GET | `/attachments/:id` | metadata |
| GET | `/attachments/:id/download` | attachment disposition; PDFs may use `?inline=1` |
| DELETE | `/attachments/:id` | |

### Experiments and questions

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/experiments?projectId&status` | |
| POST | `/experiments` | |
| GET/PATCH/DELETE | `/experiments/:id` | |
| GET | `/questions?projectId&status` | |
| POST | `/questions` | `{question,projectId?,context?}` |
| PATCH/DELETE | `/questions/:id` | |
| POST | `/questions/:id/answer` | `{noteId?}` or creates a note from `{text}`; links `answers` |

### Inbox

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/inbox?status=new|triaged|archived` | |
| POST | `/inbox` | `{body,kind?,projectId?}` |
| POST | `/inbox/:id/convert` | `{to, projectId?, overrides?}` → creates object, marks triaged, `derived_from` link |
| POST | `/inbox/:id/archive` | |
| DELETE | `/inbox/:id` | |

### Search and retrieval

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/search?q&type&projectId&tag&from&to&mode=text|semantic|hybrid&limit` | Results with snippets, scores, highlights |
| GET | `/search/suggest?q` | ≤ 8 title suggestions for palette |
| POST | `/search/reindex` | enqueue full rebuild (admin) |
| GET | `/search/status` | chunk/embedding coverage |

### Activity and journal

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/activity?projectId&objectId&type&from&to&before&limit` | chronological, newest first, `before=seq` |
| GET | `/activity/diff?date=YYYY-MM-DD` | deterministic diff |
| GET | `/journal?from&to` | digest list |
| GET | `/journal/:date` | `{digest, diff, events}`; generates deterministic diff on read |
| POST | `/journal/:date/generate` | `{force?}` → job; returns 202 with job id |
| GET | `/journal/:date/revisions` | previous summaries |

### AI

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/ai/status` | configured providers, models, embedding coverage, degraded reasons |
| GET | `/ai/providers` | keys masked |
| POST | `/ai/providers` | `{name,kind,baseUrl,apiKey?,chatModel,embedModel?,rerankModel?}` |
| PATCH | `/ai/providers/:id` | blank `apiKey` keeps existing |
| DELETE | `/ai/providers/:id` | |
| POST | `/ai/providers/:id/test` | minimal chat round-trip; returns latency/model |
| GET | `/ai/conversations` | |
| POST | `/ai/conversations` | `{scope,projectId?,contextObjectIds?,title?}` |
| GET | `/ai/conversations/:id` | messages + citations |
| PATCH | `/ai/conversations/:id` | title/scope/context |
| DELETE | `/ai/conversations/:id` | |
| POST | `/ai/conversations/:id/messages` | **SSE** response |
| POST | `/ai/actions` | `{action,objectIds,projectId?}` → non-streamed result for summarize/compare/related |
| POST | `/ai/messages/:id/to-note` | `{projectId?}` → new note + `derived_from` |
| POST | `/ai/messages/:id/extract-tasks` | `{projectId}` → creates unchecked tasks, returns them |

### Export, backup, settings, jobs, trash

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/export/workspace.zip` | streamed |
| GET | `/export/projects/:id.zip` | |
| GET | `/export/notes/:id.md` | |
| GET | `/export/references.bib` | |
| GET | `/backups` | |
| POST | `/backups` | `{kind:'manual'}` → 202 job |
| POST | `/backups/:id/verify` | checksums + integrity |
| GET | `/backups/:id/download` | |
| DELETE | `/backups/:id` | file + row |
| POST | `/backups/restore?confirm=RESTORE` | multipart archive; blocks writes, forces re-login |
| GET | `/settings` | app + user, secrets masked |
| PATCH | `/settings/app` | instance name, retention, digest time, max upload |
| PATCH | `/settings/appearance` | mode, palette, accent, density |
| GET | `/jobs?status=` | |
| POST | `/jobs/:id/retry` | |
| GET | `/trash` | soft-deleted objects and projects |
| DELETE | `/trash/projects/:id` | purge a project and its objects |
| POST | `/trash/:id/restore` | |
| DELETE | `/trash/:id` | purge (cascades) |
| POST | `/trash/empty` | purge all trashed objects and projects |
| GET | `/healthz` | 🔓 liveness |
| GET | `/readyz` | 🔓 readiness details (no secrets) |

## 3. SSE contract

Request:

```
POST /api/v1/ai/conversations/:id/messages
Accept: text/event-stream
X-CSRF-Token: …
Content-Type: application/json

{ "content": "Compare these papers", "contextObjectIds": ["ref_…"] }
```

Response: `text/event-stream`, no buffering, heartbeats every 15 s as comments (`: ping`).

```
event: user
data: {"messageId":"msg_01…"}

event: meta
data: {"assistantMessageId":"msg_01…","sources":2,"model":"llama3.1:8b"}

event: delta
data: {"text":"The two papers"}

event: citations
data: {"citations":[{"index":1,"objectId":"ref_…","locator":{"page":4},…}]}

event: usage
data: {"inputTokens":812,"outputTokens":340,"costUsd":0.0021}

event: done
data: {"messageId":"msg_01…"}

event: error
data: {"code":"provider_timeout","message":"The model timed out."}
```

Rules:
- The user message is persisted before streaming begins (so a crash does not lose the question).
- The assistant message is persisted as `pending`? **No partial rows:** it is written once at completion, and on error an assistant message with `error` and any partial text is stored. Reconnects show completed history only.
- If the client disconnects, the server aborts the upstream request and stores an assistant message marked `error: "cancelled"` only if some text was produced.
- Citations are sent before `done` and also embedded in the persisted message.

## 4. Content negotiation and downloads

- Uploads: `multipart/form-data`, field `file`, optional `kind`.
- Downloads set `Content-Disposition: attachment; filename="…"` (sanitised ASCII fallback + RFC 5987).
- Inline PDF viewing requires `?inline=1` and serves `application/pdf` only; all other types are attachment-only.
- ZIP exports stream with `application/zip`.
- API responses use `Cache-Control: no-store` except static assets.

## 5. Validation and shape rules

- Titles: 1–300 chars, trimmed; empty titles are allowed only for drafts.
- Note blocks: max 2 000; block text max 100 000 chars each; document max 4 MB.
- Tags: max 30 per object, 1–40 chars, `^[^#,\s][^,]{0,39}$`.
- Uploads: max 50 MB default (`LOOM_MAX_UPLOAD_MB`), 25 MB for PDF extraction by default.
- URLs: http(s) only, max 2 048 chars, SSRF-guarded.
- `dueDate`/`startDate`: `YYYY-MM-DD`, valid calendar dates.
- Enums are validated with zod and mirrored in SQL `CHECK` constraints where practical.

## 6. Versioning policy

- `/api/v1` is stable within v1. Additive fields and endpoints are non-breaking.
- Removing/renaming fields requires `/api/v2`.
- The SPA and API ship together; no external clients are promised compatibility, but a generated OpenAPI description is a P2 addition and must not drift further from the implementation until then.
