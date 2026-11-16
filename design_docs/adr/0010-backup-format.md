# ADR 0010 — Versioned SQLite backup + ZIP manifest

**Status:** Accepted

## Context

Backups must be complete, verifiable, restorable and understandable in five years. The source design proposed a versioned directory format with a manifest and checksums, plus a SQLite snapshot for portability.

## Decision

Backups are ZIP archives containing:

```
manifest.json         format/version/schema/app/time/counts/keyFingerprint/files
db/loom.db            online SQLite snapshot
attachments/...       referenced content-addressed blobs
checksums.sha256      every file except itself
README.txt            human instructions
```

Restore validates the manifest, checksums, DB integrity, schema version and blob presence **before** mutating anything, creates a pre-restore backup, and imports rows in a single transaction. Portable exports (JSONL/Markdown/BibTeX) are a separate format with secrets removed and no in-app restore in v1.

## Consequences

- One file to move; exact restoration; integrity is provable.
- Full-size backups (no incrementals); attachments dominate size. Acceptable at < 20 GB.
- Same-schema restore only in v1; older backups need the old app version. Documented.
- `keyFingerprint` detects master-key mismatch for encrypted provider keys.
- Restore is synchronous and single-process; writes are blocked during it.

## Alternatives rejected

- **Copy the live DB file:** unsafe under WAL writes.
- **pg_dump-style SQL text:** larger, slower, and does not capture FTS internals faithfully in all cases; SQLite's backup API is exact.
- **JSON-only export as backup:** no sessions/jobs, slower restore, loses FTS.
