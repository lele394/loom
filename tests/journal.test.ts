import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';

let harness: TestHarness;
beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

describe('journal and digest', () => {
  it('computes the diff without AI and generates an archived summary', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await harness.request('POST', '/notes', {
      title: 'Journal note',
      projectId: harness.projectId,
      blocks: [{ type: 'paragraph', text: 'Today I measured energy counters.' }],
    });
    const before = await harness.request('GET', `/journal/${today}`);
    expect(before.body.diff.totals.added).toBeGreaterThanOrEqual(1);
    expect(before.body.digest).toBeNull();
    expect(before.body.note).toBeNull();

    const note = await harness.request('PUT', `/journal/${today}/note`, {
      noteMarkdown: 'Spent the afternoon reading an untracked textbook chapter.',
    });
    expect(note.status).toBe(200);
    expect(note.body.note.noteMarkdown).toContain('textbook');
    const withNote = await harness.request('GET', `/journal/${today}`);
    expect(withNote.body.note.noteMarkdown).toContain('textbook');

    await harness.request('POST', '/ai/providers', {
      name: 'Offline demo',
      kind: 'fake',
      chatModel: '',
      embedModel: 'fake-embed',
      isDefault: true,
    });
    const queued = await harness.request('POST', `/journal/${today}/generate`, { force: false });
    expect(queued.status).toBe(202);
    await harness.drain();
    const after = await harness.request('GET', `/journal/${today}`);
    expect(after.body.digest.status).toBe('ready');
    expect(after.body.digest.summaryMarkdown).toContain('## Focus');
    expect(after.body.digest.sourceEventSeq).toBeGreaterThanOrEqual(1);
    expect(after.body.digest.stale).toBe(false);
    expect(after.body.events.length).toBeGreaterThanOrEqual(1);

    await harness.request('PUT', `/journal/${today}/note`, {
      noteMarkdown: 'Updated context after the digest was generated.',
    });
    const stale = await harness.request('GET', `/journal/${today}`);
    expect(stale.body.digest.stale).toBe(true);

    const regenerated = await harness.request('POST', `/journal/${today}/generate`, { force: true });
    expect(regenerated.status).toBe(202);
    await harness.drain();
    const revisions = await harness.request('GET', `/journal/${today}/revisions`);
    expect(revisions.body.revisions.length).toBeGreaterThanOrEqual(1);
    expect(revisions.body.revisions[0].summaryMarkdown).toContain('## Focus');
  });

  it('keeps an empty day deterministic and usable', async () => {
    const response = await harness.request('GET', '/journal/2020-01-01');
    expect(response.status).toBe(200);
    expect(response.body.diff.eventCount).toBe(0);
    expect(response.body.diff.byProject).toEqual([]);
  });
});
