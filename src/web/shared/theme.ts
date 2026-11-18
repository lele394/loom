import type { Appearance, CustomPalette } from '../../shared/types';
import { PALETTES, type AppearanceMode, type Palette } from '../../shared/constants';

export const PALETTE_META: { id: Palette; label: string; accent: string; light: string; dark: string }[] = [
  { id: 'lavender', label: 'Lavender', accent: '#7c5cbf', light: '#f7f5fa', dark: '#14121b' },
  { id: 'sakura', label: 'Sakura', accent: '#b64f70', light: '#fdf6f5', dark: '#191216' },
  { id: 'sage', label: 'Sage', accent: '#4f7a5b', light: '#f4f7f2', dark: '#101713' },
  { id: 'ocean', label: 'Ocean', accent: '#327a96', light: '#f2f7fa', dark: '#0e161c' },
  { id: 'midnight', label: 'Midnight', accent: '#8fa2ff', light: '#eef0f7', dark: '#0d1020' },
  { id: 'graphite', label: 'Graphite', accent: '#6b6257', light: '#f4f4f3', dark: '#161718' },
];

export const DEFAULT_APPEARANCE: Appearance = {
  mode: 'system',
  palette: 'lavender',
  accent: '',
  density: 'comfortable',
  customPalette: null,
};

export function resolveMode(mode: AppearanceMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const value = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((value) => clamp(value).toString(16).padStart(2, '0')).join('')}`;
}

export function mix(hexA: string, hexB: string, weightB: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return hexA;
  return rgbToHex([
    a[0] * (1 - weightB) + b[0] * weightB,
    a[1] * (1 - weightB) + b[1] * weightB,
    a[2] * (1 - weightB) + b[2] * weightB,
  ]);
}

function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastText(hex: string): string {
  return luminance(hex) > 0.45 ? '#17151d' : '#ffffff';
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

const THEME_VARIABLES = [
  '--bg',
  '--surface',
  '--surface-2',
  '--surface-3',
  '--text',
  '--text-muted',
  '--text-faint',
  '--border',
  '--border-strong',
  '--accent',
  '--accent-hover',
  '--accent-soft',
  '--accent-contrast',
  '--ring',
  '--reader',
  '--info',
  '--info-soft',
  '--scheme-1',
  '--scheme-2',
  '--scheme-3',
  '--scheme-4',
  '--scheme-5',
];

function readableColor(color: string, background: string, dark: boolean): string {
  let adjusted = color;
  for (let attempt = 0; attempt < 5 && contrastRatio(adjusted, background) < 3.2; attempt++) {
    adjusted = mix(adjusted, dark ? '#ffffff' : '#000000', 0.22);
  }
  return adjusted;
}

function applyCustomPalette(
  root: HTMLElement,
  custom: CustomPalette,
  palette: (typeof PALETTE_META)[number],
  dark: boolean,
): void {
  const colors = custom.colors.filter((color) => /^#[0-9a-fA-F]{6}$/.test(color));
  const scheme = colors.length === 5 ? colors : ['#7c5cbf', '#9d83d1', '#5d4697', '#c6b4e6', '#402f73'];
  const primary = scheme[0]!;
  const neutralBg = dark ? '#14121b' : palette.light;
  const neutralSurface = dark ? '#1d1a27' : '#ffffff';
  const neutralText = dark ? '#ece9f4' : '#302c39';
  const bg = mix(neutralBg, primary, dark ? 0.05 : 0.035);
  const surface = mix(neutralSurface, primary, dark ? 0.05 : 0.025);
  const accent = readableColor(primary, surface, dark);
  const info = readableColor(scheme[1]!, surface, dark);
  const accentSoftBase = scheme[2] ?? primary;
  const ringBase = scheme[3] ?? primary;

  const variables: Record<string, string> = {
    '--bg': bg,
    '--surface': surface,
    '--surface-2': mix(bg, primary, dark ? 0.1 : 0.065),
    '--surface-3': mix(bg, primary, dark ? 0.17 : 0.11),
    '--text': mix(neutralText, primary, dark ? 0.06 : 0.055),
    '--text-muted': mix(mix(neutralText, bg, dark ? 0.34 : 0.42), primary, 0.035),
    '--text-faint': mix(mix(neutralText, bg, dark ? 0.55 : 0.58), primary, 0.025),
    '--border': mix(surface, primary, dark ? 0.18 : 0.14),
    '--border-strong': mix(surface, scheme[4] ?? primary, dark ? 0.3 : 0.24),
    '--accent': accent,
    '--accent-hover': dark ? mix(accent, '#ffffff', 0.13) : mix(accent, '#000000', 0.13),
    '--accent-soft': mix(bg, accentSoftBase, dark ? 0.24 : 0.17),
    '--accent-contrast': contrastText(accent),
    '--ring': mix(bg, ringBase, 0.45),
    '--reader': dark ? mix('#ddd7ea', primary, 0.06) : mix('#3d3747', primary, 0.045),
    '--info': info,
    '--info-soft': mix(bg, info, dark ? 0.22 : 0.16),
    '--scheme-1': scheme[0]!,
    '--scheme-2': scheme[1]!,
    '--scheme-3': scheme[2]!,
    '--scheme-4': scheme[3]!,
    '--scheme-5': scheme[4]!,
  };
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.dataset.theme = PALETTES.includes(appearance.palette) ? appearance.palette : 'lavender';
  root.dataset.mode = resolveMode(appearance.mode);
  root.dataset.density = appearance.density;
  const resolved = resolveMode(appearance.mode);
  const palette = PALETTE_META.find((item) => item.id === appearance.palette) ?? PALETTE_META[0]!;

  if (appearance.customPalette) {
    applyCustomPalette(root, appearance.customPalette, palette, resolved === 'dark');
  } else {
    for (const name of THEME_VARIABLES) root.style.removeProperty(name);
    const base = appearance.accent || (resolved === 'dark' ? palette.accent : palette.accent);
    if (appearance.accent) {
      const background = resolved === 'dark' ? palette.dark : palette.light;
      root.style.setProperty('--accent', base);
      root.style.setProperty(
        '--accent-hover',
        resolved === 'dark' ? mix(base, '#ffffff', 0.12) : mix(base, '#000000', 0.12),
      );
      root.style.setProperty('--accent-soft', mix(background, base, resolved === 'dark' ? 0.24 : 0.16));
      root.style.setProperty('--accent-contrast', contrastText(base));
      root.style.setProperty('--ring', mix(background, base, 0.45));
    }
  }
  try {
    localStorage.setItem('loom-appearance', JSON.stringify(appearance));
  } catch {
    // storage may be disabled
  }
}

export function readLocalAppearance(): Appearance | null {
  try {
    const raw = localStorage.getItem('loom-appearance');
    if (!raw) return null;
    return { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<Appearance>) };
  } catch {
    return null;
  }
}
