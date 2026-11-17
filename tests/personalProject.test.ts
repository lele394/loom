import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';

let harness: TestHarness;

beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

describe('Personal project', () => {
  it('is always present, usable and protected from rename, archive and deletion', async () => {
    const projects = await harness.request('GET', '/projects');
    expect(projects.status).toBe(200);
    const personal = projects.body.projects.find((project: { isSystem: boolean }) => project.isSystem);
    expect(personal).toMatchObject({
      name: 'Personal',
      status: 'active',
      isSystem: true,
    });

    const columns = await harness.request('GET', `/projects/${personal.id}/columns`);
    expect(columns.body.columns).toHaveLength(4);

    const note = await harness.request('POST', '/notes', {
      title: 'Personal admin',
      projectId: personal.id,
      blocks: [{ type: 'paragraph', text: 'Uni calendar lives here.' }],
    });
    expect(note.status).toBe(201);

    const envelope = await harness.request('GET', `/objects/${note.body.id}`);
    expect(envelope.status).toBe(200);
    expect(envelope.body.object.projectId).toBe(personal.id);

    const renamed = await harness.request('PATCH', `/projects/${personal.id}`, {
      name: 'Renamed',
    });
    expect(renamed.status).toBe(400);

    const archived = await harness.request('POST', `/projects/${personal.id}/archive`, {
      archived: true,
    });
    expect(archived.status).toBe(400);

    const deleted = await harness.request('DELETE', `/projects/${personal.id}`);
    expect(deleted.status).toBe(400);

    const after = await harness.request('GET', '/projects');
    const stillThere = after.body.projects.find((project: { id: string }) => project.id === personal.id);
    expect(stillThere).toBeTruthy();
    expect(stillThere.status).toBe('active');
  });
});
