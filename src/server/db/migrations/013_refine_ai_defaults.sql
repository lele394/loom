UPDATE ai_providers SET is_chat_default = 0, is_embedding_default = 0;

UPDATE ai_providers
SET is_chat_default = 1
WHERE id = (
  SELECT id FROM ai_providers
  WHERE kind = 'fake' OR chat_model <> ''
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1
);

UPDATE ai_providers
SET is_embedding_default = 1
WHERE id = (
  SELECT id FROM ai_providers
  WHERE embed_model <> ''
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1
);
