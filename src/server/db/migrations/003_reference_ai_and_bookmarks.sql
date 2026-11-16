ALTER TABLE literature ADD COLUMN ai_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE literature ADD COLUMN ai_summary_model TEXT;
ALTER TABLE literature ADD COLUMN ai_summary_at TEXT;
ALTER TABLE literature ADD COLUMN ai_summary_instructions TEXT NOT NULL DEFAULT '';

CREATE TABLE reference_bookmarks (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL REFERENCES literature(id) ON DELETE CASCADE,
  page INTEGER NOT NULL CHECK (page > 0),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 250),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_reference_bookmarks_ref ON reference_bookmarks(reference_id, page);
