import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';

let harness: TestHarness;

beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

describe('AI provider defaults', () => {
  it('allows different default providers for chat and embeddings', async () => {
    const chat = await harness.request('POST', '/ai/providers', {
      name: 'Remote inference',
      kind: 'fake',
      chatModel: 'remote-chat',
      embedModel: '',
      isChatDefault: true,
    });
    expect(chat.status).toBe(201);

    const embeddings = await harness.request('POST', '/ai/providers', {
      name: 'Laptop embeddings',
      kind: 'fake',
      chatModel: '',
      embedModel: 'nomic-embed-text',
      isEmbeddingDefault: true,
    });
    expect(embeddings.status).toBe(201);

    const chatId = chat.body.providers.find(
      (provider: { name: string }) => provider.name === 'Remote inference',
    ).id;
    const embeddingId = embeddings.body.providers.find(
      (provider: { name: string }) => provider.name === 'Laptop embeddings',
    ).id;

    const status = await harness.request('GET', '/ai/status');
    expect(status.body.chat).toBe(true);
    expect(status.body.embeddings).toBe(true);
    expect(status.body.defaultProvider.id).toBe(chatId);
    expect(status.body.defaultEmbeddingProvider.id).toBe(embeddingId);

    expect(harness.ctx.services.settings.getChatProviderConfig()?.id).toBe(chatId);
    expect(harness.ctx.services.settings.getEmbeddingProviderConfig()?.id).toBe(embeddingId);
    expect(harness.ctx.services.search.embeddingConfig()?.model).toBe('nomic-embed-text');

    const providers = status.body.providers as {
      id: string;
      isChatDefault: boolean;
      isEmbeddingDefault: boolean;
    }[];
    expect(providers.find((provider) => provider.id === chatId)).toMatchObject({
      isChatDefault: true,
      isEmbeddingDefault: false,
    });
    expect(providers.find((provider) => provider.id === embeddingId)).toMatchObject({
      isChatDefault: false,
      isEmbeddingDefault: true,
    });
  });
});
