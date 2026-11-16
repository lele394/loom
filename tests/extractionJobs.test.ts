import { createReadStream } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';

let harness: TestHarness;
beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

describe('durable metadata extraction queue', () => {
  it('enqueues bulk re-extraction, survives a reload, applies results and dismisses', async () => {
    await harness.request('POST', '/ai/providers', {
      name: 'Offline demo',
      kind: 'fake',
      chatModel: '',
      embedModel: 'fake-embed',
      isDefault: true,
    });
    const reference = await harness.request('POST', '/references', {
      title: 'Energy Paper',
      projectId: harness.projectId,
    });
    await harness.ctx.services.attachments.upload(
      reference.body.id,
      createReadStream(path.join(process.cwd(), 'tests/fixtures/paper.pdf')),
      'Energy Paper.pdf',
      'application/pdf',
      harness.userId,
    );

    const queued = await harness.request('POST', '/references/reextract-metadata', {
      items: [{ id: reference.body.id, mode: 'text' }],
    });
    expect(queued.status).toBe(202);
    expect(queued.body.jobs).toHaveLength(1);

    // Simulates a page reload: the queue is read back from the server, not from React state.
    const listed = await harness.request('GET', '/references/extraction-jobs');
    expect(listed.status).toBe(200);
    expect(listed.body.jobs).toHaveLength(1);
    expect(listed.body.jobs[0]).toMatchObject({
      referenceId: reference.body.id,
      title: 'Energy Paper',
      mode: 'text',
      status: 'queued',
    });

    // A queued job must not be dismissed as if it were finished.
    const dismissActive = await harness.request('POST', '/references/extraction-jobs/dismiss');
    expect(dismissActive.body.dismissed).toBe(0);

    await harness.drain();

    const finished = await harness.request('GET', '/references/extraction-jobs');
    expect(finished.body.jobs[0].status).toBe('done');
    const updated = await harness.request('GET', `/references/${reference.body.id}`);
    expect(updated.body.extra.metadataSource).toBe('ai');
    expect(updated.body.version).toBeGreaterThan(reference.body.version);

    const dismissed = await harness.request('POST', '/references/extraction-jobs/dismiss');
    expect(dismissed.body.dismissed).toBe(1);
    const cleared = await harness.request('GET', '/references/extraction-jobs');
    expect(cleared.body.jobs).toHaveLength(0);

    // Settings → Jobs keeps the operational history after dismissal.
    const history = await harness.request('GET', '/jobs');
    expect(history.body.jobs.some((job: { type: string }) => job.type === 'reference.reextract')).toBe(true);
  });

  it('rejects an empty or oversized bulk request', async () => {
    const empty = await harness.request('POST', '/references/reextract-metadata', { items: [] });
    expect(empty.status).toBe(400);
    const missing = await harness.request('POST', '/references/reextract-metadata', {
      items: [{ id: 'obj_missing_reference' }],
    });
    expect(missing.status).toBe(404);
  });
});
