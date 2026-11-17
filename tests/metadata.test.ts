import { describe, expect, it } from 'vitest';
import { heuristicMetadataFromText, parseMetadataResponse } from '../src/server/modules/literature/metadata';

const FIRST_PAGE = `Taylor & Francis

Taylor & Francis Group

Business Failures: Another Example of the Analysis of Failure Data

Author(s): K. S. Lomax

Source: Journal of the American Statistical Association, Vol. 49, No. 268 (Dec., 1954), pp.
847-852

Published by: Taylor & Francis on behalf of the American Statistical Association

Stable URL: https://www.jstor.org/stable/ 2281544

Accessed: 21-09-2026 15:28 UTC

BUSINESS FAILURES: ANOTHER EXAMPLE OF THE
ANALYSIS OF FAILURE DATA

K. 8. Lomax
University of Manchester

The analyses of failure data given by Davis [1]`;

describe('metadata response parsing', () => {
  it('parses the canonical JSON contract', () => {
    const metadata = parseMetadataResponse(`{
      "title": "Energy-Delay Efficiency of VLSI Computations",
      "authors": ["Paul I. Pénzes", "Alain J. Martin"],
      "year": 2002,
      "venue": "GLSVLSI",
      "doi": "10.1145/509907.509912",
      "url": null,
      "abstract": "In this paper we introduce an energy-delay efficiency metric that captures any trade-off.",
      "type": "inproceedings",
      "publishedAt": "2002-04-18"
    }`);
    expect(metadata).toEqual({
      title: 'Energy-Delay Efficiency of VLSI Computations',
      authors: ['Paul I. Pénzes', 'Alain J. Martin'],
      year: 2002,
      venue: 'GLSVLSI',
      doi: '10.1145/509907.509912',
      abstract: 'In this paper we introduce an energy-delay efficiency metric that captures any trade-off.',
      type: 'inproceedings',
      publishedAt: '2002-04-18',
    });
  });

  it('accepts uppercase keys, aliases, string authors and fenced prose', () => {
    const metadata = parseMetadataResponse(`Here is the extracted data:

\`\`\`json
{
  "Title": "Aliased Metadata Paper",
  "Authors": "Ada Lovelace; Alan Turing",
  "Year": "2002",
  "Publication": "GLSVLSI",
  "DOI": "https://doi.org/10.1145/1234567.1234568",
  "URL": "https://example.org/paper",
  "Abstract": "This paper studies energy-delay efficiency in VLSI computation.",
  "Type": "Conference Paper",
  "PublishedAt": "2002-04-18"
}
\`\`\`

Done.`);
    expect(metadata).toMatchObject({
      title: 'Aliased Metadata Paper',
      authors: ['Ada Lovelace', 'Alan Turing'],
      year: 2002,
      venue: 'GLSVLSI',
      doi: '10.1145/1234567.1234568',
      url: 'https://example.org/paper',
      type: 'inproceedings',
      publishedAt: '2002-04-18',
    });
  });

  it('unwraps nested objects, arrays and trailing commas', () => {
    const metadata = parseMetadataResponse(
      'Some prose [{"metadata": {"DOI": "10.1000/xyz", "Title": "Nested Paper", "Year": 1999,},}] tail',
    );
    expect(metadata).toEqual({
      title: 'Nested Paper',
      year: 1999,
      doi: '10.1000/xyz',
    });
  });

  it('returns an empty object for valid JSON without recognisable fields', () => {
    expect(parseMetadataResponse('{"foo":"bar"}')).toEqual({});
    expect(parseMetadataResponse('no json here')).toBeNull();
    expect(parseMetadataResponse('')).toBeNull();
  });

  it('drops invalid DOI, year, URL and date values', () => {
    const metadata = parseMetadataResponse(
      '{"title":"T","doi":"not-a-doi","year":"ninety","url":"javascript:alert(1)","publishedAt":"someday"}',
    );
    expect(metadata).toEqual({ title: 'T' });
  });
});

describe('metadata heuristic fallback', () => {
  it('extracts title, authors, year, venue and URL from first-page OCR text', () => {
    const metadata = heuristicMetadataFromText(FIRST_PAGE, 'paper');
    expect(metadata.title).toBe('Business Failures: Another Example of the Analysis of Failure Data');
    expect(metadata.authors).toEqual(['K. S. Lomax']);
    expect(metadata.year).toBe(1954);
    expect(metadata.venue).toBe('Journal of the American Statistical Association');
    expect(metadata.publishedAt).toBe('1954-12-01');
    expect(metadata.url).toBe('https://www.jstor.org/stable/2281544');
  });

  it('falls back to the title hint when no title is present', () => {
    const metadata = heuristicMetadataFromText('short', 'Energy Paper');
    expect(metadata.title).toBe('Energy Paper');
  });
});
