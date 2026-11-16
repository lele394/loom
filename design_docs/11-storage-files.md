# 11 — Files, attachments and blob storage

## 1. Storage model

All binaries are stored in a **content-addressed blob store**:

```
data/attachments/<sha[0:2]>/<sha[2:4]>/<sha256>
```

- The file name is the SHA-256 of the content. No original names, no user-controlled paths, no traversal risk.
- Identical uploads share one blob; `attachments.blob_hash` references it.
- Writes are atomic: stream to `data/tmp/<random>`, fsync if configured, then `rename()` into place (same filesystem). Existing blob → discard temp.
- Permissions: directories 0750, files 0640, owned by the service user.
- The blob store is a port:

```ts
interface BlobStore {
  put(stream: Readable, opts: { maxBytes: number }): Promise<{ hash: string; size: number }>
  open(hash: string): Promise<Readable>
  stat(hash: string): Promise<{ size: number } | null>
  remove(hash: string): Promise<void>
  health(): Promise<boolean>
}
```

The local implementation is the only one in v1; S3/NAS adapters implement the same interface.

## 2. Attachments

An attachment row links a blob to exactly one object:

| Field | Notes |
| --- | --- |
| kind | `pdf`, `image`, `csv`, `data`, `other` |
| filename | sanitised original name for display/download |
| mime | sniffed MIME, not the client's claim |
| size | bytes |
| page_count | PDFs |
| text_status | `none`, `pending`, `ready`, `failed` |
| meta_json | page map, CSV preview stats, dimensions, archive source URL |

Allowed uploads: PDF, PNG, JPEG, WebP, GIF, CSV/TSV, plain text, JSON, ZIP (datasets), and unknown types as `other` (download only). HTML/SVG/JS are stored as `other` and always served as attachments. URL capture additionally creates a generated `text/html` archive attachment (raw page + extracted text indexed as chunks) with `meta.archiveOf` set to the final URL.

Limits (configurable): 50 MB per file, 10 attachments per object, 200 MB per upload request. PDFs above 2 000 pages are stored but not extracted.

## 3. PDF extraction

1. `extract.attachment` job downloads the blob to a temp file.
2. `unpdf` (pdf.js) extracts text per page without rendering.
3. Produce:
   - full text (for `attachment_text`)
   - page map `[{page, start, end}]` (character offsets into full text)
   - page count
   - first-page DOI candidate via regex (`10.\d{4,9}/[-._;()/:A-Z0-9]+`)
4. Store text + map; mark `ready` or `failed` with an error message.
5. If a DOI is found and no DOI is set on the reference, propose it (`reference.doi_detected` event, UI shows "Apply DOI"). Never overwrite an existing DOI automatically.
6. Enqueue `index.object`: chunks of ~1 200 chars with page locators, then embeddings.

Extraction runs off the request path. The reference page shows a status chip and a retry button.

## 4. Citation anchors

- Note citation locator: `{ "blockId": "blk_…" }` → the UI opens the note and scrolls to/highlights that block.
- PDF citation locator: `{ "page": 4, "chunkId": "chk_…" }` → the PDF iframe opens at `#page=4&highlight=…` (browser support varies; the excerpt is always shown as a fallback).
- Web reference: `{ "field": "abstract" }` plus the URL.
- Locators are opaque JSON; the frontend interprets by `objectType`.

## 5. Downloads

`GET /attachments/:id/download`

- Session required; no public links (a signed-link feature is future work).
- Sets `Content-Disposition: attachment; filename="<ascii-fallback>"; filename*=UTF-8''<encoded>`.
- PDFs with `?inline=1` are served `application/pdf` inline; everything else is always `attachment` and `application/octet-stream` unless a safe type (PNG/JPEG/WebP/GIF/CSV text).
- `Cache-Control: private, max-age=0, must-revalidate`; supports `ETag` (the hash) and range requests for PDFs (implemented by streaming from disk with `Content-Range`).
- Never reflects the original filename in headers without CR/LF sanitisation.

## 6. Deduplication and garbage collection

- Dedup is by content hash: uploading the same PDF twice creates two attachment rows (different objects) but one blob.
- Deleting an attachment removes its row. A daily `attachment.gc` job lists blobs on disk, compares with `SELECT DISTINCT blob_hash FROM attachments` (plus an in-flight grace period of 24 h by mtime), and deletes orphans.
- GC is skipped if a backup is currently running; it is logged and reports bytes reclaimed.

## 7. Quotas and health

- `GET /meta` reports total attachment bytes, count and the configured limit (default 10 GB; `LOOM_MAX_STORAGE_GB`). Uploads beyond the quota return `413 storage_quota_exceeded`.
- `/readyz` verifies the data directory is writable and the attachments root exists.
- Disk-full errors surface as `507 storage_full` with an actionable message.

## 8. CSV and datasets

- CSV/TSV attachments are parsed for a preview (first 50 rows, 20 columns) stored in `meta_json` (never the full file).
- Numeric column statistics (min/max/mean/count) are computed for experiment metrics suggestions (P1).
- The file itself is downloaded for real analysis; Loom does not attempt to be a dataframe tool.

## 9. Encryption and integrity

- Blobs are not encrypted at rest in v1; full-disk encryption is recommended in deployment docs. Backup archives include blobs and inherit filesystem protections.
- Integrity is content-addressed: re-hashing a blob on read is optional (expensive); backup creation re-hashes every included blob and fails verification on mismatch.
- A `fsck` job (P2) can verify all blobs and report missing/corrupt files without blocking the UI.

## 10. Failure handling

| Failure | Behaviour |
| --- | --- |
| Upload interrupted | Temp file removed by TTL cleanup; no DB row |
| Move/rename fails | Upload fails; temp cleaned; error returned |
| Blob missing at download | 404 `attachment_missing`, UI offers re-upload |
| Extraction crashes | `text_status=failed` + error; reference remains usable |
| Disk full | 507, no partial row committed |
