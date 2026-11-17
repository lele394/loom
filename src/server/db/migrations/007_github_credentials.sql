CREATE TABLE github_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_enc TEXT NOT NULL,
  token_hint TEXT NOT NULL DEFAULT '',
  login TEXT,
  token_type TEXT NOT NULL DEFAULT 'unknown',
  scopes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
