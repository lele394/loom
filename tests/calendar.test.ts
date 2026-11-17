import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';

let harness: TestHarness;

beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

function isoFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

describe('project calendar', () => {
  it('creates, aggregates, updates and deletes calendar items', async () => {
    const second = await harness.request('POST', '/projects', {
      name: 'Second project',
      color: 'sage',
    });
    expect(second.status).toBe(201);

    const deadline = await harness.request('POST', '/calendar', {
      projectId: harness.projectId,
      title: 'Submit camera-ready',
      type: 'deadline',
      description: 'Upload the final PDF and source archive.',
      startsAt: isoFromNow(24),
      endsAt: null,
    });
    expect(deadline.status).toBe(201);
    expect(deadline.body.type).toBe('deadline');
    expect(deadline.body.projectName).toBe('My Research');

    const meeting = await harness.request('POST', '/calendar', {
      projectId: second.body.id,
      title: 'Planning meeting',
      type: 'meeting',
      description: 'Review the next experiments.',
      startsAt: isoFromNow(48),
      endsAt: isoFromNow(49),
    });
    expect(meeting.status).toBe(201);
    expect(meeting.body.projectColor).toBe('sage');

    const from = isoFromNow(-24);
    const to = isoFromNow(24 * 14);
    const list = await harness.request(
      'GET',
      `/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items[0].title).toBe('Submit camera-ready');

    const scoped = await harness.request(
      'GET',
      `/calendar?projectId=${second.body.id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(scoped.body.items).toHaveLength(1);
    expect(scoped.body.items[0].title).toBe('Planning meeting');

    const upcoming = await harness.request('GET', '/calendar/upcoming?limit=8');
    expect(upcoming.status).toBe(200);
    expect(upcoming.body.items.map((item: { title: string }) => item.title)).toEqual([
      'Submit camera-ready',
      'Planning meeting',
    ]);

    const invalid = await harness.request('PATCH', `/calendar/${meeting.body.id}`, {
      endsAt: isoFromNow(1),
    });
    expect(invalid.status).toBe(400);

    const updated = await harness.request('PATCH', `/calendar/${deadline.body.id}`, {
      title: 'Submit final camera-ready',
      type: 'milestone',
      description: '',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('Submit final camera-ready');
    expect(updated.body.type).toBe('milestone');

    const removed = await harness.request('DELETE', `/calendar/${deadline.body.id}`);
    expect(removed.status).toBe(200);
    const after = await harness.request(
      'GET',
      `/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(after.body.items).toHaveLength(1);
    expect(after.body.items[0].id).toBe(meeting.body.id);
  });
});
