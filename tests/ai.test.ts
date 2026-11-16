import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';

let harness: TestHarness;
beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

async function waitForMessages(h: TestHarness, conversationId: string) {
  let last: { messages?: { id: string; role: string; citations: { objectId: string }[]; usage?: { promptVersion?: string } }[] } = {};
  for (let attempt = 0; attempt < 60; attempt++) {
    last = (await h.request('GET', `/ai/conversations/${conversationId}`)).body;
    if ((last.messages?.length ?? 0) >= 2) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return last;
}

async function enableFakeProvider(h: TestHarness) {
  const response = await h.request('POST', '/ai/providers', {
    name: 'Offline demo',
    kind: 'fake',
    chatModel: '',
    embedModel: 'fake-embed',
    isDefault: true,
  });
  expect([201, 200]).toContain(response.status);
  await h.drain();
}

describe('AI assistant', () => {
  it('streams a cited answer and persists it', async () => {
    await enableFakeProvider(harness);
    const note = await harness.request('POST', '/notes', {
      title: 'Frequency scaling observations',
      projectId: harness.projectId,
      blocks: [{ type: 'paragraph', text: 'DVFS reduced energy-to-solution without numerical drift.' }],
    });
    const conversation = await harness.request('POST', '/ai/conversations', {
      scope: 'selection',
      contextObjectIds: [note.body.id],
      projectId: harness.projectId,
    });
    const stream = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/ai/conversations/${conversation.body.id}/messages`,
      headers: {
        cookie: harness.cookieHeader(),
        'x-csrf-token': harness.csrfToken(),
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      payload: JSON.stringify({ content: 'What did I observe?' }),
    });
    expect(stream.statusCode).toBe(200);
    const events = stream.body;
    expect(events).toContain('event: user');
    expect(events).toContain('event: delta');
    expect(events).toContain('event: citations');
    expect(events).toContain('event: done');
    expect(events).toContain('Frequency scaling observations');
    expect(events).toContain('[1]');

    const stored = await waitForMessages(harness, conversation.body.id);
    expect(stored.messages).toHaveLength(2);
    const assistant = stored.messages![1]!;
    expect(assistant.role).toBe('assistant');
    expect(assistant.citations.length).toBe(1);
    expect(assistant.citations[0].objectId).toBe(note.body.id);
    expect(assistant.usage?.promptVersion).toBe('chat@1');
  });

  it('converts a message to a note and extracts tasks', async () => {
    await enableFakeProvider(harness);
    const note = await harness.request('POST', '/notes', {
      title: 'Context note',
      blocks: [{ type: 'paragraph', text: 'Energy counters are useful for measuring DVFS impact.' }],
    });
    const conversation = await harness.request('POST', '/ai/conversations', {
      scope: 'selection',
      contextObjectIds: [note.body.id],
    });
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/ai/conversations/${conversation.body.id}/messages`,
      headers: {
        cookie: harness.cookieHeader(),
        'x-csrf-token': harness.csrfToken(),
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ content: 'Summarise.' }),
    });
    const stored = await waitForMessages(harness, conversation.body.id);
    const assistantId = stored.messages![1]!.id;

    const saved = await harness.request('POST', `/ai/messages/${assistantId}/to-note`, {
      projectId: harness.projectId,
      title: 'AI synthesis',
    });
    expect(saved.status).toBe(201);
    const savedNote = await harness.request('GET', `/notes/${saved.body.noteId}`);
    expect(savedNote.body.title).toBe('AI synthesis');

    const tasks = await harness.request('POST', `/ai/messages/${assistantId}/extract-tasks`, {
      projectId: harness.projectId,
    });
    expect(tasks.status).toBe(200);
    expect(tasks.body.created.length).toBeGreaterThanOrEqual(1);
  });

  it('reports a clear error when no provider is configured', async () => {
    const status = await harness.request('GET', '/ai/status');
    expect(status.body.chat).toBe(false);
    const conversation = await harness.request('POST', '/ai/conversations', { scope: 'global' });
    const response = await harness.request('POST', `/ai/conversations/${conversation.body.id}/messages`, {
      content: 'Hello',
    });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('ai_unavailable');
  });
});
