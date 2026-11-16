import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';

let harness: TestHarness;
beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

describe('notes and links', () => {
  it('creates from a template, saves, and bumps versions', async () => {
    const created = await harness.request('POST', '/notes', {
      title: 'Frequency scaling',
      template: 'research',
      projectId: harness.projectId,
    });
    expect(created.status).toBe(201);
    const note = created.body;
    expect(note.blocks.length).toBeGreaterThan(2);
    expect(note.version).toBe(1);

    const saved = await harness.request('PUT', `/notes/${note.id}`, {
      title: 'Frequency scaling observations',
      blocks: [{ type: 'paragraph', text: 'DVFS reduced energy.' }],
      expectedVersion: 1,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(2);
    expect(saved.body.title).toBe('Frequency scaling observations');

    const stale = await harness.request('PUT', `/notes/${note.id}`, {
      blocks: [{ type: 'paragraph', text: 'stale' }],
      expectedVersion: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');
    expect(stale.body.error.details.currentVersion).toBe(2);
  });

  it('force-saves and keeps a snapshot', async () => {
    const created = await harness.request('POST', '/notes', {
      title: 'Snapshots',
      blocks: [{ type: 'paragraph', text: 'v1' }],
    });
    const note = created.body;
    const saved = await harness.request('PUT', `/notes/${note.id}`, {
      blocks: [{ type: 'paragraph', text: 'v2' }],
      expectedVersion: 99,
      force: true,
    });
    expect(saved.status).toBe(200);
    const versions = await harness.request('GET', `/notes/${note.id}/versions`);
    expect(versions.body.versions.length).toBeGreaterThanOrEqual(1);
    expect(versions.body.versions[0].reason).toBe('pre-overwrite');
  });

  it('resolves wikilinks and exposes backlinks', async () => {
    const task = await harness.request('POST', '/tasks', {
      title: 'Implement DVFS sweep',
      projectId: harness.projectId,
    });
    const note = await harness.request('POST', '/notes', {
      title: 'Frequency observations',
      projectId: harness.projectId,
      blocks: [{ type: 'paragraph', text: 'This relates to [[Implement DVFS sweep]].' }],
    });
    const links = await harness.request('GET', `/objects/${note.body.id}/links`);
    expect(links.body.links).toHaveLength(1);
    expect(links.body.links[0].targetId).toBe(task.body.id);
    expect(links.body.links[0].kind).toBe('mentions');
    const backlinks = await harness.request('GET', `/objects/${task.body.id}/links`);
    expect(backlinks.body.backlinks).toHaveLength(1);
    expect(backlinks.body.backlinks[0].object.id).toBe(note.body.id);
  });

  it('moves to trash and restores blocks', async () => {
    const created = await harness.request('POST', '/notes', {
      title: 'Trash me',
      blocks: [{ type: 'paragraph', text: 'keep me' }],
    });
    await harness.request('DELETE', `/notes/${created.body.id}`);
    const gone = await harness.request('GET', `/notes/${created.body.id}`);
    expect(gone.status).toBe(404);
    const trash = await harness.request('GET', '/trash');
    expect(trash.body.objects.some((object: { id: string }) => object.id === created.body.id)).toBe(true);
    const restored = await harness.request('POST', `/trash/${created.body.id}/restore`);
    expect(restored.status).toBe(200);
    const back = await harness.request('GET', `/notes/${created.body.id}`);
    expect(back.body.blocks[0].text).toBe('keep me');
  });

  it('links a reference and supports backlinks', async () => {
    const note = await harness.request('POST', '/notes', { title: 'Paper note' });
    const reference = await harness.request('POST', '/references', {
      title: 'Energy counters',
      projectId: harness.projectId,
    });
    const link = await harness.request('POST', `/objects/${note.body.id}/links`, {
      targetId: reference.body.id,
      kind: 'cites',
    });
    expect(link.status).toBe(201);
    const links = await harness.request('GET', `/objects/${note.body.id}/links`);
    expect(links.body.links[0].kind).toBe('cites');
  });
});
