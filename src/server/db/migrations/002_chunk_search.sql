-- Full-text index over chunks so PDF text is searchable without bloating object rows.
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  chunk_id UNINDEXED,
  object_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
