CREATE TABLE reference_summary_versions (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL REFERENCES literature(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 250),
  summary_md TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  model TEXT,
  mode TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_reference_summary_versions_ref
  ON reference_summary_versions(reference_id, created_at DESC);

INSERT INTO reference_summary_versions
  (id, reference_id, title, summary_md, prompt, model, mode, instructions, created_by, created_at)
SELECT
  'sver_' || lower(hex(randomblob(16))),
  l.id,
  '',
  l.ai_summary,
  'Prompt was not recorded for this historical summary.',
  l.ai_summary_model,
  '',
  l.ai_summary_instructions,
  o.created_by,
  COALESCE(l.ai_summary_at, o.updated_at)
FROM literature l
JOIN objects o ON o.id = l.id
WHERE l.ai_summary IS NOT NULL AND trim(l.ai_summary) <> '';
