CREATE TABLE calendar_subscriptions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  last_synced_at TEXT,
  last_sync_error TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_calendar_subscriptions_project ON calendar_subscriptions(project_id);

ALTER TABLE calendar_items ADD COLUMN subscription_id TEXT REFERENCES calendar_subscriptions(id) ON DELETE CASCADE;
ALTER TABLE calendar_items ADD COLUMN external_uid TEXT;

CREATE UNIQUE INDEX idx_calendar_items_external
  ON calendar_items(subscription_id, external_uid)
  WHERE subscription_id IS NOT NULL;
