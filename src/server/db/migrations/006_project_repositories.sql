CREATE TABLE project_repositories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'github' CHECK (provider IN ('github')),
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  token_enc TEXT,
  default_branch TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  last_sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, owner, name)
);

CREATE INDEX idx_project_repositories_project ON project_repositories(project_id);

CREATE TABLE repository_commits (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sha TEXT NOT NULL,
  message TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  author_login TEXT,
  author_email TEXT,
  committed_at TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (repository_id, sha)
);

CREATE INDEX idx_repository_commits_project_day ON repository_commits(project_id, committed_at);
CREATE INDEX idx_repository_commits_repository ON repository_commits(repository_id, committed_at);
