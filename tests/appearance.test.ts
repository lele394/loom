import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';
import { generateScheme, hexToHsl, hslToHex } from '../src/web/shared/colorScheme';

let harness: TestHarness;

beforeEach(async () => {
  harness = await createTestHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

const customPalette = {
  baseColors: ['#7c5cbf'],
  colors: ['#7c5cbf', '#9d83d1', '#5d4697', '#c6b4e6', '#402f73'],
  derivation: 'monochrome',
  harmony: 'analogous',
};

describe('appearance and custom palettes', () => {
  it('generates five-colour schemes for derivations and harmonies', () => {
    const mono = generateScheme(['#7c5cbf'], 'analogous', 'monochrome');
    expect(mono).toHaveLength(5);
    expect(mono[0]).toBe('#7c5cbf');
    expect(new Set(mono).size).toBeGreaterThan(1);

    const duo = generateScheme(['#7c5cbf', '#3f7fbf'], 'complementary', 'duotone');
    expect(duo).toHaveLength(5);
    expect(duo[0]).toBe('#7c5cbf');
    expect(duo[1]).toBe('#3f7fbf');

    const tri = generateScheme(['#7c5cbf', '#3f7fbf', '#d3a229'], 'triad', 'tritone');
    expect(tri).toHaveLength(5);
    expect(new Set(tri).size).toBe(5);

    const hsl = hexToHsl('#7c5cbf');
    expect(hslToHex(hsl).toLowerCase()).toBe('#7c5cbf');
  });

  it('persists custom palettes and clears them when a preset is selected', async () => {
    const saved = await harness.request('PATCH', '/settings/appearance', {
      customPalette,
      accent: '',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.customPalette).toEqual(customPalette);

    const settings = await harness.request('GET', '/settings');
    expect(settings.body.appearance.customPalette).toEqual(customPalette);

    const cleared = await harness.request('PATCH', '/settings/appearance', {
      palette: 'sage',
      customPalette: null,
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.customPalette).toBeNull();
    expect(cleared.body.palette).toBe('sage');

    const invalid = await harness.request('PATCH', '/settings/appearance', {
      customPalette: { ...customPalette, colors: ['#7c5cbf'] },
    });
    expect(invalid.status).toBe(400);
  });
});
