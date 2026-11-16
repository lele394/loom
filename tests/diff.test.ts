import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/server/db';
import { runMigrations } from '../src/server/db/migrate';
import { mutableClock } from '../src/server/core/clock';
import { ActivityService } from '../src/server/modules/activity/service';

let db: Db | null = null;
let dir = '';
afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('daily diff', () => {
  it('classifies created, updated, completed, removed and prefers created over updated', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'loom-diff-'));
    db = openDatabase(path.join(dir, 'test.db'));
    runMigrations(db);
    const clock = mutableClock('2026-11-16T08:00:00Z');
    const activity = new ActivityService(db, clock);
    activity.record({ actorId: 'usr_x', objectId: 'obj_a', objectType: 'note', objectTitle: 'A', action: 'note.created', summary: 'Created A' });
    clock.advance(60_000);
    activity.record({ actorId: 'usr_x', objectId: 'obj_a', objectType: 'note', objectTitle: 'A', action: 'note.saved', summary: 'Saved A', changes: { blocks: { from: 1, to: 2 } } });
    clock.advance(60_000);
    activity.record({ actorId: 'usr_x', objectId: 'obj_b', objectType: 'task', objectTitle: 'B', action: 'task.completed', summary: 'Completed B' });
    clock.advance(60_000);
    activity.record({ actorId: 'usr_x', objectId: 'obj_c', objectType: 'task', objectTitle: 'C', action: 'task.deleted', summary: 'Deleted C' });
    clock.advance(24 * 3_600_000);
    activity.record({ actorId: 'usr_x', objectId: 'obj_d', objectType: 'note', objectTitle: 'Next day', action: 'note.created', summary: 'Next day' });

    const diff = activity.diff('2026-11-16', 'UTC');
    expect(diff.eventCount).toBe(4);
    expect(diff.totals).toEqual({ added: 1, updated: 0, completed: 1, removed: 1 });
    const group = diff.byProject.find((entry) => entry.projectName === 'Unfiled')!;
    expect(group.added.map((item) => item.title)).toEqual(['A']);
    expect(group.completed.map((item) => item.title)).toEqual(['B']);
    expect(group.removed.map((item) => item.title)).toEqual(['C']);
    expect(group.added[0]!.fields).toEqual(['blocks']);
  });

  it('returns an empty, stable diff for a quiet day', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'loom-diff-'));
    db = openDatabase(path.join(dir, 'test.db'));
    runMigrations(db);
    const activity = new ActivityService(db, mutableClock('2026-11-16T08:00:00Z'));
    const diff = activity.diff('2026-11-16', 'UTC');
    expect(diff.byProject).toEqual([]);
    expect(diff.eventSeqRange).toBeNull();
    expect(diff.totals).toEqual({ added: 0, updated: 0, completed: 0, removed: 0 });
  });
});
