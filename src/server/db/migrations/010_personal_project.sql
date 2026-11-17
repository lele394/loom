ALTER TABLE projects ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX idx_projects_system ON projects(is_system) WHERE is_system = 1;

INSERT INTO projects
  (id, name, description, color, status, settings_json, created_at, updated_at, is_system)
SELECT
  'prj_loom_personal',
  'Personal',
  'A place for anything that does not belong to another project.',
  'sage',
  'active',
  '{}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  1
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE is_system = 1);

INSERT INTO board_columns
  (id, project_id, name, is_done, position, created_at, updated_at)
SELECT
  'col_personal_backlog',
  p.id,
  'Backlog',
  0,
  0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM projects p
WHERE p.is_system = 1
  AND NOT EXISTS (SELECT 1 FROM board_columns c WHERE c.project_id = p.id);

INSERT INTO board_columns
  (id, project_id, name, is_done, position, created_at, updated_at)
SELECT
  'col_personal_todo',
  p.id,
  'Todo',
  0,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM projects p
WHERE p.is_system = 1
  AND (SELECT COUNT(*) FROM board_columns c WHERE c.project_id = p.id) = 1;

INSERT INTO board_columns
  (id, project_id, name, is_done, position, created_at, updated_at)
SELECT
  'col_personal_doing',
  p.id,
  'Doing',
  0,
  2,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM projects p
WHERE p.is_system = 1
  AND (SELECT COUNT(*) FROM board_columns c WHERE c.project_id = p.id) = 2;

INSERT INTO board_columns
  (id, project_id, name, is_done, position, created_at, updated_at)
SELECT
  'col_personal_done',
  p.id,
  'Done',
  1,
  3,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM projects p
WHERE p.is_system = 1
  AND (SELECT COUNT(*) FROM board_columns c WHERE c.project_id = p.id) = 3;
