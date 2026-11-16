# ADR 0006 — AI provider port with capability flags

**Status:** Accepted

## Context

Users may run Ollama locally, an OpenAI-compatible gateway, or nothing at all. Chat, embeddings and reranking do not have to come from the same model or provider. The source design correctly asked for a provider abstraction but left it undefined.

## Decision

Define an `AiProvider` port with explicit capabilities (`chat`, `embeddings`, `rerank`, `streaming`) and two adapters:

1. `openai` — any `/v1`-compatible endpoint (OpenAI, Ollama, LM Studio, vLLM, OpenRouter), configurable base URL/key/models.
2. `fake` — deterministic, offline, used by tests and demo mode.

Model roles (chat/embed/rerank) are configured independently. Failures normalise to a small error taxonomy. Capabilities are declared, not probed; a test endpoint validates configuration.

## Consequences

- No vendor lock-in; local-first is possible end to end.
- Lowest-common-denominator API; provider-specific features are unavailable until the port grows.
- The app must degrade gracefully per capability (no embeddings → text search).
- Adding a provider is a new adapter, not changes to RAG or UI.
- Tool/agent support is deliberately absent; adding it requires a permissioned tool registry.

## Alternatives rejected

- **Direct SDK calls in services:** untestable, duplicated retry logic.
- **LangChain:** large abstraction surface, fast churn, poor fit for a small explicit pipeline.
- **Single hard-coded OpenAI:** breaks local/offline users.
