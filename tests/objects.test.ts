import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';

let harness: TestHarness;
beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

describe('capture, experiments, questions and purge', () => {
  it('captures an inbox item and converts it to a task', async () => {
    const capture = await harness.request('POST', '/inbox', {
      body: 'Run a DVFS sweep on the test node',
      kind: 'task',
      projectId: harness.projectId,
    });
    expect(capture.status).toBe(201);
    const converted = await harness.request('POST', `/inbox/${capture.body.id}/convert`, {
      to: 'task',
      projectId: harness.projectId,
      title: 'DVFS sweep from inbox',
    });
    expect(converted.status).toBe(200);
    expect(converted.body.type).toBe('task');
    const task = await harness.request('GET', `/tasks/${converted.body.objectId}`);
    expect(task.body.title).toBe('DVFS sweep from inbox');
    const item = await harness.request('GET', '/inbox?status=triaged');
    expect(item.body.items.some((entry: { id: string }) => entry.id === capture.body.id)).toBe(true);
  });

  it('records experiment metrics and updates status', async () => {
    const experiment = await harness.request('POST', '/experiments', {
      title: 'DVFS baseline',
      projectId: harness.projectId,
      objective: 'Measure energy',
      metrics: [{ name: 'energy', value: 1420, unit: 'J' }],
    });
    expect(experiment.status).toBe(201);
    const updated = await harness.request('PATCH', `/experiments/${experiment.body.id}`, {
      status: 'completed',
      results: 'Energy fell by 8%.',
      metrics: [
        { name: 'energy', value: 1306, unit: 'J' },
        { name: 'runtime', value: 36.2, unit: 's' },
      ],
    });
    expect(updated.body.status).toBe('completed');
    expect(updated.body.projectId).toBe(harness.projectId);
    expect(updated.body.metrics).toHaveLength(2);
    const list = await harness.request('GET', `/experiments?projectId=${harness.projectId}&status=completed`);
    expect(list.body.experiments).toHaveLength(1);
  });

  it('answers a research question with a linked note', async () => {
    const question = await harness.request('POST', '/questions', {
      question: 'Does DVFS hurt accuracy?',
      projectId: harness.projectId,
      context: 'Central question',
    });
    const answered = await harness.request('POST', `/questions/${question.body.id}/answer`, {
      text: 'No measurable drift was observed in the sweep.',
    });
    expect(answered.body.status).toBe('answered');
    expect(answered.body.answerNoteId).toBeTruthy();
    const note = await harness.request('GET', `/notes/${answered.body.answerNoteId}`);
    expect(note.body.title).toContain('Answer:');
    const links = await harness.request('GET', `/objects/${answered.body.answerNoteId}/links`);
    expect(links.body.links[0].kind).toBe('answers');
  });

  it('restores and purges a deleted project with its objects', async () => {
    const project = await harness.request('POST', '/projects', { name: 'Trashable project' });
    const note = await harness.request('POST', '/notes', { title: 'Project note', projectId: project.body.id });
    await harness.request('DELETE', `/projects/${project.body.id}`);
    const trash = await harness.request('GET', '/trash');
    expect(trash.body.projects.some((entry: { id: string }) => entry.id === project.body.id)).toBe(true);
    expect(trash.body.objects.some((entry: { id: string }) => entry.id === note.body.id)).toBe(true);
    const restored = await harness.request('POST', `/projects/${project.body.id}/restore`);
    expect(restored.status).toBe(200);
    const projectBack = await harness.request('GET', `/projects/${project.body.id}`);
    expect(projectBack.status).toBe(200);
    const noteBack = await harness.request('GET', `/notes/${note.body.id}`);
    expect(noteBack.status).toBe(200);

    await harness.request('DELETE', `/projects/${project.body.id}`);
    await harness.request('DELETE', `/trash/projects/${project.body.id}`);
    const projectGone = await harness.request('GET', `/projects/${project.body.id}`);
    expect(projectGone.status).toBe(404);
    const noteGone = await harness.request('GET', `/notes/${note.body.id}`);
    expect(noteGone.status).toBe(404);
  });

  it('purges objects but keeps activity history', async () => {
    const note = await harness.request('POST', '/notes', { title: 'Purge me' });
    await harness.request('DELETE', `/notes/${note.body.id}`);
    const eventsBefore = harness.ctx.db
      .prepare('SELECT COUNT(*) AS count FROM activity_events WHERE object_id = ?')
      .get(note.body.id) as { count: number };
    expect(eventsBefore.count).toBeGreaterThan(0);
    await harness.request('DELETE', `/trash/${note.body.id}`);
    const gone = await harness.request('GET', `/notes/${note.body.id}`);
    expect(gone.status).toBe(404);
    const eventsAfter = harness.ctx.db
      .prepare('SELECT COUNT(*) AS count FROM activity_events WHERE object_id = ?')
      .get(note.body.id) as { count: number };
    expect(eventsAfter.count).toBeGreaterThanOrEqual(eventsBefore.count);
  });
});
