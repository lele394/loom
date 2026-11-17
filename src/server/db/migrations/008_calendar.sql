CREATE TABLE calendar_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('deadline', 'meeting', 'event', 'milestone', 'focus')),
  description TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_calendar_items_starts ON calendar_items(starts_at);
CREATE INDEX idx_calendar_items_project_starts ON calendar_items(project_id, starts_at);
