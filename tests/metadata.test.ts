import { describe, expect, it } from 'vitest';
import { heuristicMetadataFromText } from '../src/server/modules/literature/metadata';

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
