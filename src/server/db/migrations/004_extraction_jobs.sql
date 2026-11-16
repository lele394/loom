-- Durable metadata re-extraction queue.
-- Dismissing a finished job hides it from the literature queue without deleting
-- the operational job history shown in Settings → Jobs.
ALTER TABLE jobs ADD COLUMN dismissed_at TEXT;

CREATE INDEX idx_jobs_type_dismissed ON jobs(type, dismissed_at, created_at DESC);
