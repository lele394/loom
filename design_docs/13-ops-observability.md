# 13 — Operations, configuration and observability

## 1. Process model

```
npm run build          # Vite production build → dist/web
npm start              # NODE_ENV=production, tsx src/server/main.ts
```

One process:

- Fastify HTTP server (API + static SPA + SSE).
- In-process worker (jobs) and scheduler.
- Graceful shutdown on SIGINT/SIGTERM: stop accepting requests, finish the in-flight job within 10 s (else requeue), close DB.

`npm run dev` starts the API with watch mode and Vite with HMR, proxying `/api` to the server. Two processes in development only.

## 2. Configuration

All configuration via environment variables (12-factor), validated at boot with zod. Invalid values abort startup with a clear message. A `.env` file is loaded in development; production may use systemd `Environment=` or Docker env.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address (use `0.0.0.0` only behind a proxy/firewall) |
| `LOOM_DATA_DIR` | `./data` | Database, attachments, backups, logs, master key |
| `LOOM_DB_PATH` | `$DATA/loom.db` | Override DB location |
| `LOOM_BACKUP_DIR` | `$DATA/backups` | Backup destination |
| `LOOM_SECRET` | auto-generated file | Master key material for AES-GCM |
| `LOOM_SECURE_COOKIES` | `false` | Set `Secure` on cookies (requires HTTPS) |
| `LOOM_TRUST_PROXY` | `false` | Trust `X-Forwarded-*` from a reverse proxy |
| `LOOM_ALLOWED_ORIGIN` | empty | Extra allowed origin for CSRF/Origin checks |
| `LOOM_MAX_UPLOAD_MB` | `50` | Per-file upload cap |
| `LOOM_MAX_STORAGE_GB` | `10` | Attachment quota |
| `LOOM_WORKER_ENABLED` | `true` | Disable jobs for maintenance |
| `LOOM_SKIP_PRE_MIGRATION_BACKUP` | unset | Deliberately skip the safety snapshot (not recommended) |
| `LOOM_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `TZ` | system | Server timezone for logs only; user timezone is stored per user |

`NODE_ENV=production` enables static SPA serving and stricter CSP. In development, the server redirects non-API routes to the Vite dev URL if `LOOM_DEV_WEB_URL` is set.

## 3. Data directory layout

```
data/
├── loom.db              + -wal, -shm
├── master.key           (0600, only if LOOM_SECRET unset)
├── attachments/aa/bb/<sha256>
├── backups/loom-backup-*.zip
├── tmp/                 (cleaned at boot and hourly)
└── logs/                (optional file logs; stdout is primary)
```

The whole directory is the unit of backup/migration. Moving an instance = stop, copy `data/`, start.

## 4. Startup sequence

1. Parse config; ensure directories exist with safe permissions.
2. Resolve master key (env → file → generate).
3. Open DB, set pragmas (`journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`).
4. Run migrations. If pending and the DB has data, create a `pre_migration` backup first (best effort; if it fails, abort unless `LOOM_SKIP_PRE_MIGRATION_BACKUP=1`).
5. Requeue `running` jobs (crash recovery).
6. Build the context (services, registry, providers, worker).
7. Register HTTP routes; start listening.
8. Start worker + scheduler + cleanup timers.

A failed migration leaves the process exiting non-zero; the pre-migration backup is the recovery path.

## 5. Logging

- Pino (Fastify built-in) JSON logs to stdout, pretty in development.
- Fields: `time`, `level`, `msg`, `requestId`, `userId` (if authenticated), `route`, `status`, `durationMs`.
- Redaction paths: `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.apiKey`, `*.token`, `*.secret`.
- Never log request bodies or query strings containing `q` beyond 80 chars.
- Errors log `code`, `message`, `stack` (server-side only).

## 6. Health and readiness

`GET /healthz` → `200 {"status":"ok","uptime":…}` if the process is alive.

`GET /readyz` → `200` or `503`:

```json
{
  "status": "ok",
  "checks": {
    "db": { "ok": true, "latencyMs": 1 },
    "attachments": { "ok": true, "writable": true },
    "migrations": { "ok": true, "pending": 0, "current": 7 },
    "worker": { "ok": true, "queued": 3, "running": 1, "dead": 0, "oldestQueuedMs": 1200 },
    "disk": { "ok": true, "freeBytes": 12345678901 }
  },
  "version": "0.1.0"
}
```

No secrets, file paths or SQL errors are exposed beyond a generic message.

## 7. Error handling and recovery

| Situation | Behaviour |
| --- | --- |
| SQLITE_BUSY after retries | 503 `db_busy`, safe to retry |
| Disk full | 507 `storage_full`; writes fail cleanly; reads continue |
| Corrupt DB | Startup fails with recovery instructions; restore from backup |
| Migration checksum mismatch | Startup aborts (someone edited an applied migration) |
| Worker handler crash | Job retried with backoff, then `dead`; UI lists it |
| SSE client disconnects | Upstream aborted; partial assistant text stored only if produced |
| Restore in progress | Writes return `503 restore_in_progress` |

## 8. Deployment recipes

### Local

```bash
npm ci
npm run build
LOOM_SECURE_COOKIES=false npm start
# open http://localhost:8787
```

### systemd

```ini
[Unit]
Description=Loom research OS
After=network.target

[Service]
Type=simple
User=loom
WorkingDirectory=/opt/loom
Environment=NODE_ENV=production
Environment=PORT=8787
Environment=HOST=127.0.0.1
Environment=LOOM_DATA_DIR=/var/lib/loom
Environment=LOOM_SECURE_COOKIES=true
Environment=LOOM_TRUST_PROXY=true
ExecStart=/usr/bin/node --import tsx src/server/main.ts
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/loom

[Install]
WantedBy=multi-user.target
```

### Reverse proxy (Caddy)

```caddy
loom.example.org {
  reverse_proxy 127.0.0.1:8787
  encode zstd gzip
}
```

Disable proxy buffering for SSE (`flush_interval -1` in nginx; Caddy streams by default). Set `LOOM_TRUST_PROXY=1` and `LOOM_SECURE_COOKIES=1` when TLS is terminated.

### Docker

Multi-stage build (node:24-slim): install deps, build web, copy `src`, `node_modules`, `dist`. Volume `/data`, env `LOOM_DATA_DIR=/data`, port 8787. No root; `USER node` with a writable volume. Healthcheck hits `/healthz`.

### Upgrade procedure

1. Stop the app (or let it run during asset copy).
2. Backup first (Settings → Create backup) or copy `data/`.
3. Install new version, run migrations at boot.
4. If startup fails, restore the pre-migration backup and roll back the code.

## 9. Resource expectations

| Workspace | RAM | Disk | Startup |
| --- | --- | --- | --- |
| 1k objects, 100 PDFs | < 150 MB | < 1 GB | < 1 s |
| 10k objects, 1k PDFs | < 400 MB | ~5 GB | ~1–2 s |
| 50k objects, 5k PDFs | ~1 GB (vector scan) | ~20 GB | ~3 s |

Limits are documented rather than engineered around in v1. Exceeding them is the trigger for the Postgres/vector-index upgrade path.

## 10. Security operations

- File permissions: data dir 0700, files 0600/0640, master key 0600.
- The server never runs as root; Docker image uses a non-root user.
- TLS is the reverse proxy's job; cookies are Secure when configured.
- Backups contain the whole research corpus: store them encrypted offsite.
- `npm audit` and `npm outdated` are part of release checks; dependencies are pinned by lockfile.

## 11. Maintenance CLI

Scripts that require filesystem access, run with the server stopped when they touch the DB:

| Command | Purpose |
| --- | --- |
| `npm run reset-password -- <username>` | Prompts for a new password (or reads `LOOM_NEW_PASSWORD`), re-hashes, invalidates all sessions |
| `npm run backup` | Creates a manual backup via the same service (server stopped, or via API when running) |
| `npm run migrate` | Applies migrations only (normally done at boot) |

The reset script opens the DB directly and refuses to run if another process holds the write lock.

## 12. Disaster recovery runbook1. Install the same or newer Loom version on a new machine.
2. Start once to create `data/` (or copy the old `LOOM_SECRET`/`master.key` if AI keys must survive).
3. Log in as the fresh admin, go to Settings → Data → Restore.
4. Upload the latest backup, type `RESTORE`, confirm.
5. Verify `/readyz`, open the dashboard, check a note and a PDF, confirm counts in Settings.
6. Re-enter AI keys if the key fingerprint warning appeared.
7. Copy the new pre-restore backup offsite.

Test this runbook quarterly with a scratch instance; a backup that has never been restored is a hypothesis.
