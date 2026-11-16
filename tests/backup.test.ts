import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';
import { extractZip } from '../src/server/storage/zip';

let harness: TestHarness;
beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

describe('backup and restore', () => {
  it('creates, verifies, restores and preserves a safety backup', async () => {
    const before = await harness.request('POST', '/notes', { title: 'Before backup', projectId: harness.projectId });
    const backup = await harness.ctx.services.backup.create('manual', harness.userId);
    expect(backup.status).toBe('ready');
    const verified = await harness.ctx.services.backup.verify(backup.id);
    expect(verified.ok).toBe(true);
    expect(verified.checkedFiles).toBeGreaterThanOrEqual(2);

    const after = await harness.request('POST', '/notes', { title: 'After backup', projectId: harness.projectId });
    const result = await harness.ctx.services.backup.restore(
      harness.ctx.services.backup.filePath(backup),
      harness.userId,
    );
    expect(result.reloginRequired).toBe(true);
    expect(result.counts.objects).toBeGreaterThanOrEqual(1);

    const rows = harness.ctx.db
      .prepare("SELECT title FROM objects WHERE type = 'note' ORDER BY title")
      .all() as { title: string }[];
    const titles = rows.map((row) => row.title);
    expect(titles).toContain('Before backup');
    expect(titles).not.toContain('After backup');

    const preRestore = harness.ctx.db
      .prepare("SELECT COUNT(*) AS count FROM backups WHERE kind = 'pre_restore'")
      .get() as { count: number };
    expect(preRestore.count).toBe(1);
  });

  it('rejects a tampered archive before mutating data', async () => {
    const note = await harness.request('POST', '/notes', { title: 'Survives tampering' });
    const backup = await harness.ctx.services.backup.create('manual', harness.userId);
    const file = harness.ctx.services.backup.filePath(backup);
    const bytes = await fs.readFile(file);
    bytes[Math.floor(bytes.length / 2)] = bytes[Math.floor(bytes.length / 2)]! ^ 0xff;
    await fs.writeFile(file, bytes);
    await expect(harness.ctx.services.backup.restore(file, harness.userId)).rejects.toThrow();
    const stillThere = await harness.request('GET', `/notes/${note.body.id}`);
    expect(stillThere.status).toBe(200);
  });
});

describe('portable export', () => {
  it('exports a project with markdown, BibTeX, JSONL and checksums', async () => {
    const note = await harness.request('POST', '/notes', {
      title: 'Exported note',
      projectId: harness.projectId,
      blocks: [{ type: 'paragraph', text: 'Exportable research.' }],
    });
    await harness.request('POST', '/references', {
      title: 'Exported paper',
      authors: ['Jane Doe'],
      year: 2024,
      projectId: harness.projectId,
    });
    const file = await harness.ctx.services.export.createProjectExport(harness.projectId, 'UTC');
    const out = path.join(harness.dir, 'unzipped-export');
    await extractZip(file.filePath, out);
    const roots = await fs.readdir(out);
    const root = path.join(out, roots[0]!);
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
    expect(manifest.format).toBe('loom-export');
    expect(manifest.counts.notes).toBe(1);
    expect(manifest.files.length).toBeGreaterThan(5);
    const noteFile = manifest.files.find((entry: { path: string }) => entry.path.startsWith('notes/'));
    expect(noteFile).toBeTruthy();
    const markdown = await fs.readFile(path.join(root, noteFile.path), 'utf8');
    expect(markdown).toContain('title: "Exported note"');
    expect(markdown).toContain('Exportable research.');
    const data = await fs.readFile(path.join(root, 'data/objects.jsonl'), 'utf8');
    expect(data).toContain(note.body.id);
    const bib = await fs.readFile(path.join(root, 'literature.bib'), 'utf8');
    expect(bib).toContain('Exported paper');
    await fs.access(path.join(root, 'checksums.sha256'));
    await harness.ctx.services.export.cleanup(file.filePath);
  });
});
