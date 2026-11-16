import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';

let harness: TestHarness;
beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

describe('tasks and board', () => {
  it('creates, moves, completes and reopens a task', async () => {
    const board = await harness.request('GET', `/projects/${harness.projectId}/board`);
    const open = board.body.columns.find((column: { isDone: boolean }) => !column.isDone);
    const done = board.body.columns.find((column: { isDone: boolean }) => column.isDone);

    const created = await harness.request('POST', '/tasks', {
      title: 'DVFS sweep',
      projectId: harness.projectId,
      priority: 'high',
      dueDate: '2026-11-20',
    });
    expect(created.status).toBe(201);
    const task = created.body;

    const moved = await harness.request('POST', `/tasks/${task.id}/move`, {
      columnId: open.id,
      position: 0,
    });
    expect(moved.body.columnId).toBe(open.id);
    expect(moved.body.completedAt).toBeNull();

    const completed = await harness.request('POST', `/tasks/${task.id}/complete`, { done: true });
    expect(completed.body.columnId).toBe(done.id);
    expect(completed.body.completedAt).toBeTruthy();

    const reopened = await harness.request('POST', `/tasks/${task.id}/complete`, { done: false });
    expect(reopened.body.completedAt).toBeNull();
    expect(reopened.body.columnId).not.toBe(done.id);
  });

  it('rewrites dense order on move', async () => {
    const board = await harness.request('GET', `/projects/${harness.projectId}/board`);
    const column = board.body.columns[0];
    const a = await harness.request('POST', '/tasks', { title: 'A', projectId: harness.projectId, columnId: column.id });
    const b = await harness.request('POST', '/tasks', { title: 'B', projectId: harness.projectId, columnId: column.id });
    const c = await harness.request('POST', '/tasks', { title: 'C', projectId: harness.projectId, columnId: column.id });
    await harness.request('POST', `/tasks/${c.body.id}/move`, { columnId: column.id, position: 0 });
    const fresh = await harness.request('GET', `/projects/${harness.projectId}/board`);
    const tasks = fresh.body.columns.find((entry: { id: string }) => entry.id === column.id).tasks;
    expect(tasks.map((task: { title: string }) => task.title)).toEqual(['C', 'A', 'B']);
    expect(tasks.map((task: { position: number }) => task.position)).toEqual([0, 1, 2]);
    expect([a.status, b.status]).toEqual([201, 201]);
  });

  it('moves a task across projects and reassigns its column', async () => {
    const other = await harness.request('POST', '/projects', { name: 'Other project' });
    const otherBoard = await harness.request('GET', `/projects/${other.body.id}/board`);
    const task = await harness.request('POST', '/tasks', { title: 'Cross-project', projectId: harness.projectId });
    const moved = await harness.request('PATCH', `/tasks/${task.body.id}`, { projectId: other.body.id });
    expect(moved.status).toBe(200);
    expect(moved.body.projectId).toBe(other.body.id);
    expect(otherBoard.body.columns.some((column: { id: string }) => column.id === moved.body.columnId)).toBe(true);
    const board = await harness.request('GET', `/projects/${other.body.id}/board`);
    expect(board.body.columns.flatMap((column: { tasks: { id: string }[] }) => column.tasks).some((entry: { id: string }) => entry.id === task.body.id)).toBe(true);

    const done = otherBoard.body.columns.find((column: { isDone: boolean }) => column.isDone);
    const completed = await harness.request('PATCH', `/tasks/${task.body.id}`, { columnId: done.id });
    expect(completed.body.completedAt).toBeTruthy();
    const events = await harness.request('GET', `/activity?objectId=${task.body.id}&limit=20`);
    expect(events.body.events.some((event: { action: string }) => event.action === 'task.completed')).toBe(true);
  });

  it('rejects a column from another project', async () => {
    const other = await harness.request('POST', '/projects', { name: 'Other project' });
    const otherBoard = await harness.request('GET', `/projects/${other.body.id}/board`);
    const task = await harness.request('POST', '/tasks', { title: 'Task', projectId: harness.projectId });
    const response = await harness.request('POST', `/tasks/${task.body.id}/move`, {
      columnId: otherBoard.body.columns[0].id,
      position: 0,
    });
    expect(response.status).toBe(400);
  });

  it('rejects deleting a column that holds tasks', async () => {
    const board = await harness.request('GET', `/projects/${harness.projectId}/board`);
    const column = board.body.columns[0];
    await harness.request('POST', '/tasks', { title: 'Hold', projectId: harness.projectId, columnId: column.id });
    const response = await harness.request('DELETE', `/board-columns/${column.id}`);
    expect(response.status).toBe(400);
  });

  it('marks a project archived read-only', async () => {
    await harness.request('POST', `/projects/${harness.projectId}/archive`, { archived: true });
    const response = await harness.request('POST', '/tasks', { title: 'Blocked', projectId: harness.projectId });
    expect(response.status).toBe(423);
    await harness.request('POST', `/projects/${harness.projectId}/archive`, { archived: false });
  });
});
