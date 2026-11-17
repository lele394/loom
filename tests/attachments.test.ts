import { createReadStream, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

describe('attachments and literature', () => {
  it('uploads a PDF, extracts text and indexes page chunks', async () => {
    const reference = await harness.request('POST', '/references', {
      title: 'Energy efficient HPC',
      authors: ['Jane Doe'],
      year: 2024,
      projectId: harness.projectId,
    });
    expect(reference.status).toBe(201);
    const attachment = await harness.ctx.services.attachments.upload(
      reference.body.id,
      createReadStream(path.join(process.cwd(), 'tests/fixtures/paper.pdf')),
      'paper.pdf',
      'application/pdf',
      harness.userId,
    );
    expect(attachment.kind).toBe('pdf');
    await harness.drain();

    const envelope = await harness.request('GET', `/objects/${reference.body.id}`);
    const stored = envelope.body.attachments[0];
    expect(stored.textStatus).toBe('ready');
    expect(stored.pageCount).toBe(2);

    const search = await harness.request('GET', '/search?q=%22performance%20counters%22');
    expect(search.body.results.some((result: { objectId: string }) => result.objectId === reference.body.id)).toBe(true);
  });

  it('ingests a dropped PDF and fills metadata with the AI', async () => {
    await harness.request('POST', '/ai/providers', {
      name: 'Offline demo',
      kind: 'fake',
      chatModel: '',
      embedModel: 'fake-embed',
      isDefault: true,
    });
    const reference = await harness.ctx.services.literature.ingestPdf(
      createReadStream(path.join(process.cwd(), 'tests/fixtures/paper.pdf')),
      'Energy Paper.pdf',
      harness.projectId,
      harness.userId,
    );
    expect(reference.title).toBe('Energy Paper');
    expect(reference.extra.metadataSource).toBe('ai');
    expect(reference.projectId).toBe(harness.projectId);
    await harness.drain();
    const envelope = await harness.request('GET', `/objects/${reference.id}`);
    expect(envelope.body.attachments).toHaveLength(1);
    expect(envelope.body.attachments[0].kind).toBe('pdf');
    expect(envelope.body.attachments[0].textStatus).toBe('ready');

    const redo = await harness.request('POST', `/references/${reference.id}/reextract-metadata`, {
      source: 'pdf',
      mode: 'text',
    });
    expect(redo.status).toBe(200);
    expect(redo.body.raw).toContain('"title"');
    expect(redo.body.metadata.title).toBe('Energy Paper');
    expect(redo.body.textPreview).toContain('Energy efficient computing');
  });

  it('normalises alias-keyed model JSON and keeps OCR text out of the raw output', async () => {
    await harness.request('POST', '/ai/providers', {
      name: 'Alias metadata',
      kind: 'fake',
      chatModel: '',
      embedModel: 'fake-embed',
      isDefault: true,
      extra: { metadataStyle: 'aliases' },
    });
    const reference = await harness.request('POST', '/references', {
      title: 'Old title',
      projectId: harness.projectId,
    });
    await harness.ctx.services.attachments.upload(
      reference.body.id,
      createReadStream(path.join(process.cwd(), 'tests/fixtures/paper.pdf')),
      'Alias paper.pdf',
      'application/pdf',
      harness.userId,
    );
    const redo = await harness.request('POST', `/references/${reference.body.id}/reextract-metadata`, {
      source: 'pdf',
      mode: 'text',
    });
    expect(redo.status).toBe(200);
    expect(redo.body.raw.trim().startsWith('{')).toBe(true);
    expect(redo.body.raw).not.toContain('--- OCR TEXT ---');
    expect(redo.body.metadata).toMatchObject({
      title: 'Aliased Metadata Paper',
      authors: ['Ada Lovelace', 'Alan Turing'],
      year: 2002,
      venue: 'GLSVLSI',
      doi: '10.1145/1234567.1234568',
      url: 'https://example.org/paper',
      type: 'inproceedings',
      publishedAt: '2002-04-18',
    });
    expect(redo.body.prompt).toContain('Return only the JSON object');
  });

  const hasPoppler = spawnSync('pdftoppm', ['-v'], { stdio: 'ignore' }).status === 0;
  it.skipIf(!hasPoppler)('supports image and OCR metadata modes with rendered pages', async () => {
    await harness.request('POST', '/ai/providers', {
      name: 'Offline demo',
      kind: 'fake',
      chatModel: '',
      embedModel: 'fake-embed',
      isDefault: true,
    });
    const reference = await harness.request('POST', '/references', {
      title: 'Mode test',
      projectId: harness.projectId,
    });
    await harness.ctx.services.attachments.upload(
      reference.body.id,
      createReadStream(path.join(process.cwd(), 'tests/fixtures/paper.pdf')),
      'mode-test.pdf',
      'application/pdf',
      harness.userId,
    );
    const images = await harness.request('POST', `/references/${reference.body.id}/reextract-metadata`, {
      source: 'pdf',
      mode: 'images',
    });
    expect(images.status).toBe(200);
    expect(images.body.imageCount).toBe(2);
    expect(images.body.raw).toContain('"title"');
    expect(images.body.metadata.title).toBeTruthy();

    const ocr = await harness.request('POST', `/references/${reference.body.id}/reextract-metadata`, {
      source: 'pdf',
      mode: 'ocr',
    });
    expect(ocr.status).toBe(200);
    expect(ocr.body.raw.trim().startsWith('{')).toBe(true);
    expect(ocr.body.raw).not.toContain('OCR TEXT');
    expect(ocr.body.ocrText).toBeTruthy();
  });

  it('falls back to heuristic metadata when the provider returns no JSON', async () => {
    await harness.request('POST', '/ai/providers', {
      name: 'Empty metadata',
      kind: 'fake',
      chatModel: '',
      embedModel: 'fake-embed',
      isDefault: true,
      extra: { failWith: 'empty_metadata' },
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
    const redo = await harness.request('POST', `/references/${reference.body.id}/reextract-metadata`, {
      source: 'pdf',
      mode: 'text',
    });
    expect(redo.status).toBe(200);
    expect(redo.body.raw).toBe('');
    expect(redo.body.metadata.title).toBeTruthy();
    expect(redo.body.metadataOrigin).toBe('heuristic');
    expect(redo.body.error).toBeTruthy();
  });

  it('archives a webpage attachment and indexes its text', async () => {
    const reference = await harness.request('POST', '/references', {
      title: 'Archived page',
      projectId: harness.projectId,
    });
    await harness.ctx.services.attachments.attachGenerated(
      reference.body.id,
      'example.org-paper.html',
      'text/html',
      Buffer.from('<html><body>Archived webpage about energy counters and DVFS.</body></html>'),
      'Archived webpage about energy counters and DVFS.',
      harness.userId,
      { kind: 'data', meta: { archiveOf: 'https://example.org/paper' } },
    );
    const envelope = await harness.request('GET', `/objects/${reference.body.id}`);
    expect(envelope.body.attachments).toHaveLength(1);
    expect(envelope.body.attachments[0].filename).toBe('example.org-paper.html');
    const search = await harness.request('GET', '/search?q=%22energy%20counters%22');
    expect(search.body.results.some((result: { objectId: string }) => result.objectId === reference.body.id)).toBe(true);
  });

  it('queues an AI summary separate from personal notes', async () => {
    await harness.request('POST', '/ai/providers', {
      name: 'Offline demo',
      kind: 'fake',
      chatModel: '',
      embedModel: 'fake-embed',
      isDefault: true,
    });
    const reference = await harness.request('POST', '/references', {
      title: 'Summary paper',
      notes: 'My private note, not the summary.',
      projectId: harness.projectId,
    });
    await harness.ctx.services.attachments.upload(
      reference.body.id,
      createReadStream(path.join(process.cwd(), 'tests/fixtures/paper.pdf')),
      'summary.pdf',
      'application/pdf',
      harness.userId,
    );
    const queued = await harness.request('POST', `/references/${reference.body.id}/summarize`, {
      mode: 'text',
      instructions: 'Focus on the method.',
    });
    expect(queued.status).toBe(202);
    await harness.drain();
    const updated = await harness.request('GET', `/references/${reference.body.id}`);
    expect(updated.body.aiSummary).toContain('## Summary');
    expect(updated.body.notes).toBe('My private note, not the summary.');
    expect(updated.body.aiSummaryInstructions).toBe('Focus on the method.');
    expect(updated.body.aiSummaryModel).toContain('summary@1');
  });

  it('creates and manages page bookmarks with a 250 character note limit', async () => {
    const reference = await harness.request('POST', '/references', { title: 'Bookmarked paper' });
    const created = await harness.request('POST', `/references/${reference.body.id}/bookmarks`, {
      page: 4,
      note: 'Important table',
    });
    expect(created.status).toBe(201);
    expect(created.body.page).toBe(4);
    const tooLong = await harness.request('POST', `/references/${reference.body.id}/bookmarks`, {
      page: 5,
      note: 'x'.repeat(251),
    });
    expect(tooLong.status).toBe(400);
    const list = await harness.request('GET', `/references/${reference.body.id}/bookmarks`);
    expect(list.body.bookmarks).toHaveLength(1);
    const patched = await harness.request('PATCH', `/bookmarks/${created.body.id}`, { note: 'Updated note' });
    expect(patched.body.note).toBe('Updated note');
    await harness.request('DELETE', `/bookmarks/${created.body.id}`);
    const empty = await harness.request('GET', `/references/${reference.body.id}/bookmarks`);
    expect(empty.body.bookmarks).toHaveLength(0);
  });

  it('returns per-URL errors for a blocked multi-link ingest', async () => {
    const response = await harness.request('POST', '/references/ingest-urls', {
      urls: ['http://127.0.0.1:8080/private', 'http://10.0.0.1/admin'],
      projectId: harness.projectId,
    });
    expect(response.status).toBe(200);
    expect(response.body.created).toHaveLength(0);
    expect(response.body.errors).toHaveLength(2);
  });

  it('rejects a fake PDF by magic-byte sniffing', async () => {
    const reference = await harness.request('POST', '/references', { title: 'Fake PDF' });
    const temp = path.join(harness.dir, 'fake.pdf');
    writeFileSync(temp, 'this is definitely not a pdf');
    await expect(
      harness.ctx.services.attachments.upload(
        reference.body.id,
        createReadStream(temp),
        'fake.pdf',
        'application/pdf',
        harness.userId,
      ),
    ).rejects.toMatchObject({ code: 'unsupported_file' });
  });

  it('imports BibTeX, skips duplicates, and exports it back', async () => {
    const bibtex = `@article{doe2024energy, author={Doe, Jane}, title={Energy Efficient Computing}, journal={J HPC}, year={2024}}`;
    const first = await harness.request('POST', '/references/import-bibtex', {
      bibtex,
      projectId: harness.projectId,
    });
    expect(first.body.created).toBe(1);
    const second = await harness.request('POST', '/references/import-bibtex', {
      bibtex,
      projectId: harness.projectId,
    });
    expect(second.body.skipped).toBe(1);
    const exported = await harness.request('GET', '/references.bib');
    expect(exported.status).toBe(200);
    expect(exported.text).toContain('@article{doe2024energy');
  });

  it('blocks private URL ingestion (SSRF)', async () => {
    const response = await harness.request('POST', '/references/ingest-url', {
      url: 'http://127.0.0.1:8080/private',
    });
    expect(response.status).toBe(400);
  });

  it('updates reading status and mirrors it on the object', async () => {
    const reference = await harness.request('POST', '/references', { title: 'Reading status' });
    const updated = await harness.request('PATCH', `/references/${reference.body.id}`, {
      readingStatus: 'reviewed',
      rating: 4,
    });
    expect(updated.body.readingStatus).toBe('reviewed');
    const objects = await harness.request('GET', '/objects?type=reference&status=reviewed');
    expect(objects.body.objects.some((object: { id: string }) => object.id === reference.body.id)).toBe(true);
  });
});
