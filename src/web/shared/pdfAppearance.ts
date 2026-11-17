import { useCallback, useEffect, useRef, useState } from 'react';

export interface PdfAppearance {
  invert: boolean;
  brightness: number;
  contrast: number;
  sepia: number;
}

export const DEFAULT_PDF_APPEARANCE: PdfAppearance = {
  invert: false,
  brightness: 100,
  contrast: 100,
  sepia: 0,
};

const STORAGE_KEY = 'loom-pdf-reader-appearance';
const CHANGE_EVENT = 'loom:pdf-appearance';

function normalize(value: Partial<PdfAppearance> | null | undefined): PdfAppearance {
  return {
    invert: Boolean(value?.invert),
    brightness: Math.min(130, Math.max(50, Number(value?.brightness) || 100)),
    contrast: Math.min(160, Math.max(60, Number(value?.contrast) || 100)),
    sepia: Math.min(100, Math.max(0, Number(value?.sepia) || 0)),
  };
}

export function readPdfAppearance(): PdfAppearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PDF_APPEARANCE;
    return normalize(JSON.parse(raw) as Partial<PdfAppearance>);
  } catch {
    return DEFAULT_PDF_APPEARANCE;
  }
}

export function canvasFilter(appearance: PdfAppearance): string {
  const filters = [`brightness(${appearance.brightness}%)`, `contrast(${appearance.contrast}%)`];
  if (appearance.sepia > 0) filters.push(`sepia(${appearance.sepia}%)`);
  if (appearance.invert) filters.push('invert(1)', 'hue-rotate(180deg)');
  return filters.join(' ');
}

/**
 * Global PDF appearance state. Changes propagate immediately to every mounted
 * viewer in this window and to other tabs through the storage event.
 */
export function usePdfAppearance(): [
  PdfAppearance,
  (patch: Partial<PdfAppearance>) => void,
] {
  const [appearance, setAppearance] = useState(readPdfAppearance);
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;

  useEffect(() => {
    const fromStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setAppearance(readPdfAppearance());
    };
    const fromWindow = (event: Event) => {
      const detail = (event as CustomEvent<Partial<PdfAppearance>>).detail;
      setAppearance(detail ? normalize(detail) : readPdfAppearance());
    };
    window.addEventListener('storage', fromStorage);
    window.addEventListener(CHANGE_EVENT, fromWindow);
    return () => {
      window.removeEventListener('storage', fromStorage);
      window.removeEventListener(CHANGE_EVENT, fromWindow);
    };
  }, []);

  const update = useCallback((patch: Partial<PdfAppearance>) => {
    const next = normalize({ ...appearanceRef.current, ...patch });
    appearanceRef.current = next;
    setAppearance(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Appearance still applies for this session if storage is disabled.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  }, []);

  return [appearance, update];
}
