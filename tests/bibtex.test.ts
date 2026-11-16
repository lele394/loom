import { describe, expect, it } from 'vitest';
import { formatBibtex, parseBibtex, splitAuthors } from '../src/server/core/bibtex';

const SAMPLE = `
@article{doe2024energy,
  author = {Doe, Jane and Smith, John},
  title = {Energy {Efficient} Computing with Counters},
  journal = {Journal of HPC},
  year = {2024},
  doi = {10.1000/xyz123},
  abstract = {A study of {DVFS} and energy.}
}
@inproceedings{lee2023,
  author = "Lee, Anna",
  title = "Precision-aware matrix multiplication",
  booktitle = "SC23",
  year = 2023
}
`;

describe('BibTeX', () => {
  it('parses nested braces and both value styles', () => {
    const { entries, errors } = parseBibtex(SAMPLE);
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.fields.title).toBe('Energy Efficient Computing with Counters');
    expect(entries[0]!.fields.doi).toBe('10.1000/xyz123');
    expect(entries[1]!.fields.booktitle).toBe('SC23');
  });

  it('splits authors and normalises Last, First', () => {
    expect(splitAuthors('Doe, Jane and Smith, John')).toEqual(['Jane Doe', 'John Smith']);
    expect(splitAuthors('Jane Doe; John Smith')).toEqual(['Jane Doe; John Smith']);
  });

  it('round-trips metadata into a valid entry', () => {
    const bib = formatBibtex({
      citeKey: 'doe2024energy',
      type: 'article',
      title: 'Energy Efficient Computing',
      authors: ['Jane Doe', 'John Smith'],
      year: 2024,
      venue: 'Journal of HPC',
      doi: '10.1000/xyz123',
      url: null,
      abstract: 'A study',
      publishedAt: null,
      extra: {},
    });
    const parsed = parseBibtex(bib);
    expect(parsed.entries[0]!.citeKey).toBe('doe2024energy');
    expect(parsed.entries[0]!.fields.author).toContain('Jane Doe');
  });
});
