import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';

let harness: TestHarness;
beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

describe('search', () => {
  it('finds notes by body text with snippets and filters', async () => {
    const note = await harness.request('POST', '/notes', {
      title: 'Frequency scaling observations',
      projectId: harness.projectId,
      blocks: [{ type: 'paragraph', text: 'The quasiparticle measurement used hardware performance counters.' }],
    });
    const search = await harness.request('GET', '/search?q=quasiparticle&mode=text');
    expect(search.status).toBe(200);
    expect(search.body.results).toHaveLength(1);
    expect(search.body.results[0].objectId).toBe(note.body.id);
    expect(search.body.results[0].snippet).toContain('quasiparticle');
    const filtered = await harness.request('GET', `/search?q=quasiparticle&type=reference`);
    expect(filtered.body.results).toHaveLength(0);
  });

  it('removes deleted objects from results', async () => {
    const note = await harness.request('POST', '/notes', {
      title: 'Temporary finding',
      blocks: [{ type: 'paragraph', text: 'obfuscatedterm' }],
    });
    const before = await harness.request('GET', '/search?q=obfuscatedterm');
    expect(before.body.results).toHaveLength(1);
    await harness.request('DELETE', `/notes/${note.body.id}`);
    const after = await harness.request('GET', '/search?q=obfuscatedterm');
    expect(after.body.results).toHaveLength(0);
  });

  it('filters by tag and project', async () => {
    const tag = await harness.request('POST', '/tags', { name: 'dvfs' });
    const note = await harness.request('POST', '/notes', {
      title: 'Tagged note',
      projectId: harness.projectId,
      blocks: [{ type: 'paragraph', text: 'frequencyvoltage' }],
    });
    await harness.request('PUT', `/objects/${note.body.id}/tags`, { tagIds: [tag.body.id] });
    const byTag = await harness.request('GET', '/search?q=frequencyvoltage&tag=dvfs');
    expect(byTag.body.results).toHaveLength(1);
    const otherProject = await harness.request('POST', '/projects', { name: 'Other' });
    const wrongProject = await harness.request('GET', `/search?q=frequencyvoltage&projectId=${otherProject.body.id}`);
    expect(wrongProject.body.results).toHaveLength(0);
  });

  it('does not let FTS operators break the query', async () => {
    const response = await harness.request('GET', '/search?q=%22NEAR(energy)%22%20OR%20*');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.results)).toBe(true);
  });

  it('indexes embeddings and exposes hybrid retrieval', async () => {
    await harness.request('POST', '/notes', {
      title: 'Energy note',
      projectId: harness.projectId,
      blocks: [{ type: 'paragraph', text: 'Energy-to-solution with DVFS on HPC nodes.' }],
    });
    await harness.request('POST', '/ai/providers', {
      name: 'Offline demo',
      kind: 'fake',
      chatModel: '',
      embedModel: 'fake-embed',
      isDefault: true,
    });
    await harness.drain();
    const status = await harness.request('GET', '/search/status');
    expect(status.body.embedded).toBeGreaterThan(0);
    const hybrid = await harness.request('GET', '/search?q=DVFS&mode=hybrid');
    expect(hybrid.status).toBe(200);
    expect(hybrid.body.results.length).toBeGreaterThan(0);
    expect(hybrid.body.engines).toContain('text');
  });
});
