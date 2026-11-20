ALTER TABLE ai_providers ADD COLUMN is_chat_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_providers ADD COLUMN is_embedding_default INTEGER NOT NULL DEFAULT 0;

UPDATE ai_providers SET is_chat_default = is_default, is_embedding_default = is_default;

CREATE UNIQUE INDEX idx_ai_providers_chat_default
  ON ai_providers(is_chat_default) WHERE is_chat_default = 1;
CREATE UNIQUE INDEX idx_ai_providers_embedding_default
  ON ai_providers(is_embedding_default) WHERE is_embedding_default = 1;
