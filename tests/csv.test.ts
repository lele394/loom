import { describe, expect, it } from 'vitest';
import { parseCsvPreview } from '../src/server/core/csv';

describe('CSV preview', () => {
  it('parses quoted fields and embedded commas', () => {
    const preview = parseCsvPreview('name,value\n"energy, J",1420\nruntime,36.2\n');
    expect(preview.headers).toEqual(['name', 'value']);
    expect(preview.rows[0]).toEqual(['energy, J', '1420']);
  });
});
