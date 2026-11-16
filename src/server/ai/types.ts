export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AiContentPart[];
}

export function messageText(content: string | AiContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export interface ChatRequest {
  model?: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
}

export type ChatChunk =
  | { type: 'text'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'finish'; reason?: string };

export interface AiCapabilities {
  chat: boolean;
  embeddings: boolean;
  rerank: boolean;
  streaming: boolean;
}

export interface AiProvider {
  id: string;
  name: string;
  kind: 'openai' | 'fake';
  caps: AiCapabilities;
  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
  embed(input: string[], model: string, signal?: AbortSignal): Promise<number[][]>;
  rerank?(query: string, documents: string[], model: string, signal?: AbortSignal): Promise<number[]>;
  health(signal?: AbortSignal): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}

export function chatError(status: number, body: string): Error {
  const message = body.slice(0, 500);
  if (status === 401 || status === 403) {
    return Object.assign(new Error(`Provider authentication failed: ${message}`), {
      code: 'provider_auth',
    });
  }
  if (status === 429) {
    return Object.assign(new Error(`Provider rate limited: ${message}`), {
      code: 'provider_rate_limited',
    });
  }
  if (status >= 500) {
    return Object.assign(new Error(`Provider error: ${message}`), { code: 'provider_error' });
  }
  return Object.assign(new Error(`Provider rejected the request: ${message}`), {
    code: 'provider_error',
  });
}
