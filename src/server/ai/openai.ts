import type { ProviderConfig } from '../modules/settings/service';
import type {
  AiCapabilities,
  AiProvider,
  ChatChunk,
  ChatRequest,
} from './types';
import { chatError } from './types';

export class OpenAiProvider implements AiProvider {
  readonly kind = 'openai' as const;
  readonly caps: AiCapabilities = {
    chat: true,
    embeddings: true,
    rerank: false,
    streaming: true,
  };

  constructor(private readonly config: ProviderConfig) {}

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    const onAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onAbort, { once: true });

    const body: Record<string, unknown> = {
      model: request.model || this.config.chatModel,
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: request.temperature ?? 0.2,
    };
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.json) body.response_format = { type: 'json_object' };

    try {
      const response = await fetch(this.url('/chat/completions'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw chatError(response.status, await response.text());
      }
      if (!response.body) {
        throw Object.assign(new Error('Provider returned no response body.'), {
          code: 'provider_bad_response',
        });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            let parsed: {
              choices?: { delta?: { content?: string }; finish_reason?: string }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number };
              error?: { message?: string };
            };
            try {
              parsed = JSON.parse(payload);
            } catch {
              continue;
            }
            if (parsed.error?.message) {
              throw Object.assign(new Error(parsed.error.message), {
                code: 'provider_error',
              });
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) yield { type: 'text', text: delta };
            if (parsed.usage) {
              yield {
                type: 'usage',
                inputTokens: parsed.usage.prompt_tokens ?? 0,
                outputTokens: parsed.usage.completion_tokens ?? 0,
              };
            }
            const finish = parsed.choices?.[0]?.finish_reason;
            if (finish) yield { type: 'finish', reason: finish };
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw Object.assign(new Error('The AI provider timed out or was cancelled.'), {
          code: 'provider_timeout',
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }

  async embed(input: string[], model: string, signal?: AbortSignal): Promise<number[][]> {
    if (!model) throw Object.assign(new Error('No embedding model configured.'), { code: 'ai_unavailable' });
    const response = await fetch(this.url('/embeddings'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model, input }),
      signal: signal ?? AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw chatError(response.status, await response.text());
    }
    const payload = (await response.json()) as {
      data?: { embedding: number[]; index: number }[];
    };
    if (!payload.data?.length) {
      throw Object.assign(new Error('Provider returned no embeddings.'), {
        code: 'provider_bad_response',
      });
    }
    return payload.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }

  async health(signal?: AbortSignal): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const started = Date.now();
    try {
      const response = await fetch(this.url('/models'), {
        headers: this.headers(),
        signal: signal ?? AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return { ok: false, latencyMs: Date.now() - started, error: `HTTP ${response.status}` };
      }
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, error: (error as Error).message };
    }
  }
}
