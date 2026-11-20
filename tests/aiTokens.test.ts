import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';

let harness: TestHarness;

beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

describe('AI token budgets', () => {
  it('exposes larger context and configurable output budgets', async () => {
    const settings = await harness.request('GET', '/settings');
    expect(settings.body.app.aiContextTokens).toBe(64_000);
    expect(settings.body.app.aiChatOutputTokens).toBe(1_200);
    expect(settings.body.app.aiSummaryOutputTokens).toBe(6_000);

    const updated = await harness.request('PATCH', '/settings/app', {
      aiContextTokens: 96_000,
      aiChatOutputTokens: 4_000,
      aiSummaryOutputTokens: 8_000,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.aiContextTokens).toBe(96_000);
    expect(updated.body.aiChatOutputTokens).toBe(4_000);
    expect(updated.body.aiSummaryOutputTokens).toBe(8_000);

    const meta = await harness.request('GET', '/meta');
    expect(meta.body.app.aiContextTokens).toBe(96_000);
    expect(meta.body.app.aiChatOutputTokens).toBe(4_000);
    expect(meta.body.app.aiSummaryOutputTokens).toBe(8_000);

    const invalid = await harness.request('PATCH', '/settings/app', {
      aiContextTokens: 10,
    });
    expect(invalid.status).toBe(400);
  });
});
