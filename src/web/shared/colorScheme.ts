import type { ColorDerivationMode, ColorHarmonyMode } from '../../shared/constants';

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export const HARMONY_LABELS: Record<ColorHarmonyMode, string> = {
  monochrome: 'Monochrome',
  shades: 'Shades',
  analogous: 'Analogous',
  complementary: 'Complementary',
  'split-complementary': 'Split complementary',
  triad: 'Triad',
  square: 'Square',
  compound: 'Compound',
};

export const DERIVATION_LABELS: Record<ColorDerivationMode, string> = {
  monochrome: 'Monochrome',
  duotone: 'Duo-tone',
  tritone: 'Tri-tone',
};

const HARMONY_OFFSETS: Record<ColorHarmonyMode, number[]> = {
  monochrome: [0, 0, 0, 0, 0],
  shades: [0, 0, 0, 0, 0],
  analogous: [0, 30, -30, 60, -60],
  complementary: [0, 180, 15, 195, 345],
  'split-complementary': [0, 150, 210, 20, 340],
  triad: [0, 120, 240, 60, 300],
  square: [0, 90, 180, 270, 45],
  compound: [0, 180, 30, 210, 330],
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHue(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const value = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function hexToHsl(hex: string): Hsl {
  const rgb = hexToRgb(hex) ?? [128, 92, 191];
  const [r, g, b] = rgb.map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) h = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex(hsl: Hsl): string {
  const h = normalizeHue(hsl.h) / 360;
  const s = clamp(hsl.s, 0, 100) / 100;
  const l = clamp(hsl.l, 0, 100) / 100;
  if (s === 0) {
    const value = Math.round(l * 255);
    return rgbToHex([value, value, value]);
  }
  const hueToRgb = (p: number, q: number, t: number): number => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex([
    hueToRgb(p, q, h + 1 / 3) * 255,
    hueToRgb(p, q, h) * 255,
    hueToRgb(p, q, h - 1 / 3) * 255,
  ]);
}

/** Generate a five-colour scheme, keeping the first base tone as the primary. */
export function generateScheme(
  baseColors: string[],
  harmony: ColorHarmonyMode,
  derivation: ColorDerivationMode,
): string[] {
  const fallback = baseColors[0] || '#7c5cbf';
  const needed = derivation === 'tritone' ? 3 : derivation === 'duotone' ? 2 : 1;
  const bases = Array.from({ length: needed }, (_, index) => baseColors[index] || fallback);
  const sets = bases.map((base) => harmonyColors(base, harmony));
  if (bases.length === 1) return sets[0]!;

  const colors: string[] = [];
  let index = 0;
  while (colors.length < 5) {
    for (let baseIndex = 0; baseIndex < sets.length && colors.length < 5; baseIndex++) {
      colors.push(sets[baseIndex]![index]!);
    }
    index += 1;
  }
  return colors;
}

function harmonyColors(base: string, harmony: ColorHarmonyMode): string[] {
  const hsl = hexToHsl(base);
  const offsets = HARMONY_OFFSETS[harmony] ?? HARMONY_OFFSETS.analogous;
  const lightnessSteps = [0, 7, -7, 15, -15];
  const saturationSteps = [0, -4, 4, -8, 8];
  return offsets.map((offset, index) => {
    if (harmony === 'monochrome' || harmony === 'shades') {
      const shadeStep = harmony === 'shades' ? [0, 14, -14, 28, -28][index]! : lightnessSteps[index]!;
      return hslToHex({
        h: hsl.h,
        s: clamp(hsl.s + (harmony === 'shades' ? 0 : saturationSteps[index]!), 8, 100),
        l: clamp(hsl.l + shadeStep, 12, 92),
      });
    }
    return hslToHex({
      h: hsl.h + offset,
      s: clamp(hsl.s + saturationSteps[index]!, 10, 100),
      l: clamp(hsl.l + lightnessSteps[index]!, 12, 92),
    });
  });
}

export function wheelPosition(color: string): { x: number; y: number } {
  const hsl = hexToHsl(color);
  const angle = (normalizeHue(hsl.h) * Math.PI) / 180;
  const radius = (clamp(hsl.s, 0, 100) / 100) * 50;
  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius,
  };
}

export function colorFromWheel(
  xPercent: number,
  yPercent: number,
  source: string,
): string {
  const dx = xPercent - 50;
  const dy = yPercent - 50;
  const distance = Math.hypot(dx, dy);
  const saturation = clamp((distance / 50) * 100, 0, 100);
  const hue = normalizeHue((Math.atan2(dy, dx) * 180) / Math.PI);
  const sourceHsl = hexToHsl(source);
  return hslToHex({ h: hue, s: saturation, l: sourceHsl.l });
}
