CREATE TABLE pdf_annotations (
  id TEXT PRIMARY KEY,
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  page INTEGER NOT NULL CHECK (page > 0),
  kind TEXT NOT NULL CHECK (kind IN ('highlight', 'ink', 'note')),
  color TEXT NOT NULL DEFAULT '#f2c94c',
  geometry_json TEXT NOT NULL DEFAULT '{}',
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_pdf_annotations_attachment ON pdf_annotations(attachment_id, page);
