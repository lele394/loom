export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  requestId?: string;

  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

let csrfToken = readCookie('loom_csrf');

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

function url(path: string): string {
  return path.startsWith('/api/') ? path : `/api/v1${path}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (unsafe) {
    const token = csrfToken ?? readCookie('loom_csrf');
    if (token) headers['x-csrf-token'] = token;
  }
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(url(path), {
    method,
    headers,
    body: payload,
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } })?.error;
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('loom:unauthorized'));
    }
    throw new ApiError(
      response.status,
      error?.code ?? 'request_failed',
      error?.message ?? `Request failed (${response.status}).`,
      error?.details,
      error?.requestId,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, file: File, field = 'file') => {
    const form = new FormData();
    form.append(field, file);
    return request<T>('POST', path, form);
  },
};

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

/** POST and consume an SSE stream (fetch streaming, so CSRF headers work). */
export async function streamChat(
  conversationId: string,
  content: string,
  contextObjectIds: string[],
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url(`/ai/conversations/${conversationId}/messages`), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-csrf-token': csrfToken ?? readCookie('loom_csrf') ?? '',
    },
    body: JSON.stringify({ content, contextObjectIds }),
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiError(
      response.status,
      data?.error?.code ?? 'request_failed',
      data?.error?.message ?? 'The AI request failed.',
    );
  }
  if (!response.body) throw new Error('No response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        if (!block.trim() || block.startsWith(':')) continue;
        const lines = block.split('\n');
        let data = '';
        for (const line of lines) {
          if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        try {
          onEvent(JSON.parse(data) as StreamEvent);
        } catch {
          // ignore malformed frames
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Navigate to an authenticated download. This streams server-side instead of buffering in memory. */
export function download(path: string, filename?: string): void {
  const anchor = document.createElement('a');
  anchor.href = url(path);
  if (filename) anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
