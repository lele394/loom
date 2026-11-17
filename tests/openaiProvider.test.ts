import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenAiProvider } from '../src/server/ai/openai';
import type { ChatRequest } from '../src/server/ai/types';

let server: ReturnType<typeof createServer> | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

async function collect(provider: OpenAiProvider, request: ChatRequest): Promise<string> {
  let text = '';
  for await (const chunk of provider.chat(request)) {
    if (chunk.type === 'text') text += chunk.text;
  }
  return text;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function providerFor(handler: Handler): Promise<OpenAiProvider> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return new OpenAiProvider({
    id: 'test',
    name: 'test',
    kind: 'openai',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: '',
    chatModel: 'local-model',
    embedModel: '',
    rerankModel: '',
    isDefault: true,
    extra: {},
  });
}

const request: ChatRequest = {
  model: 'local-model',
  messages: [{ role: 'user', content: 'Return JSON' }],
  json: true,
};

describe('OpenAI-compatible provider', () => {
  it('reads a non-streaming JSON body when the server ignores stream:true', async () => {
    const provider = await providerFor((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '{"title":"Streamless"}' } }] }));
    });
    expect(await collect(provider, request)).toBe('{"title":"Streamless"}');
  });

  it('reads SSE chunks using message.content and array content parts', async () => {
    const provider = await providerFor((_req, res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.write(
        `data: ${JSON.stringify({
          choices: [{ message: { content: [{ type: 'text', text: 'Hello ' }] } }],
        })}\n\n`,
      );
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'world' } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
    expect(await collect(provider, request)).toBe('Hello world');
  });
});
