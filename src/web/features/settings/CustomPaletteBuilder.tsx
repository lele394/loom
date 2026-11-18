import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  COLOR_DERIVATION_MODES,
  COLOR_HARMONY_MODES,
  type ColorDerivationMode,
  type ColorHarmonyMode,
} from '../../../shared/constants';
import type { CustomPalette } from '../../../shared/types';
import {
  colorFromWheel,
  DERIVATION_LABELS,
  generateScheme,
  HARMONY_LABELS,
  hexToHsl,
  hslToHex,
  wheelPosition,
} from '../../shared/colorScheme';
import { Icon } from '../../shared/icons';
import { Field } from '../../shared/ui';

const SWATCH_LABELS = ['Primary', 'Secondary', 'Tertiary', 'Support', 'Accent'];

function validColor(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function createDefaultCustomPalette(seed: string): CustomPalette {
  const base = validColor(seed, '#7c5cbf');
  return {
    baseColors: [base],
    colors: generateScheme([base], 'analogous', 'monochrome'),
    derivation: 'monochrome',
    harmony: 'analogous',
  };
}

function ensureBaseColors(bases: string[], count: number): string[] {
  const next = bases.slice(0, count).map((color) => validColor(color, '#7c5cbf'));
  const first = next[0] ?? '#7c5cbf';
  const hsl = hexToHsl(first);
  while (next.length < count) {
    const offset = next.length === 1 ? 120 : 240;
    next.push(hslToHex({ ...hsl, h: hsl.h + offset }));
  }
  return next;
}

export function CustomPaletteBuilder({
  value,
  onChange,
  onPreview,
}: {
  value: CustomPalette;
  onChange: (value: CustomPalette) => void;
  onPreview: (value: CustomPalette) => void;
}) {
  const [draft, setDraft] = useState<CustomPalette>(value);
  const [dragging, setDragging] = useState(false);
  const wheelRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef(JSON.stringify(value));
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;

  useEffect(() => {
    onPreviewRef.current(draft);
  }, [draft]);

  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (serialized !== lastSentRef.current) {
      lastSentRef.current = serialized;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    const serialized = JSON.stringify(draft);
    if (serialized === lastSentRef.current) return;
    const timer = window.setTimeout(() => {
      lastSentRef.current = serialized;
      onChange(draft);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, onChange]);

  const setHarmony = (harmony: ColorHarmonyMode) => {
    const baseColors = ensureBaseColors(
      draft.baseColors,
      draft.derivation === 'tritone' ? 3 : draft.derivation === 'duotone' ? 2 : 1,
    );
    setDraft({
      ...draft,
      harmony,
      baseColors,
      colors: generateScheme(baseColors, harmony, draft.derivation),
    });
  };

  const setDerivation = (derivation: ColorDerivationMode) => {
    const count = derivation === 'tritone' ? 3 : derivation === 'duotone' ? 2 : 1;
    const baseColors = ensureBaseColors(draft.baseColors, count);
    setDraft({
      ...draft,
      derivation,
      baseColors,
      colors: generateScheme(baseColors, draft.harmony, derivation),
    });
  };

  const setBaseColor = (index: number, color: string) => {
    const baseColors = [...draft.baseColors];
    baseColors[index] = color;
    setDraft({
      ...draft,
      baseColors,
      colors: generateScheme(baseColors, draft.harmony, draft.derivation),
    });
  };

  const setSwatch = (index: number, color: string) => {
    const colors = [...draft.colors];
    colors[index] = color;
    setDraft({ ...draft, colors });
  };

  const regenerate = () => {
    const baseColors = ensureBaseColors(
      draft.baseColors,
      draft.derivation === 'tritone' ? 3 : draft.derivation === 'duotone' ? 2 : 1,
    );
    setDraft({
      ...draft,
      baseColors,
      colors: generateScheme(baseColors, draft.harmony, draft.derivation),
    });
  };

  const paintWheel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = wheelRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;
    const color = colorFromWheel(x, y, draft.baseColors[0] ?? '#7c5cbf');
    setBaseColor(0, color);
  };

  return (
    <div className="custom-palette-builder">
      <div className="custom-palette-top">
        <div className="color-wheel-column">
          <div
            className="color-wheel"
            ref={wheelRef}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(true);
              paintWheel(event);
            }}
            onPointerMove={(event) => {
              if (dragging) paintWheel(event);
            }}
            onPointerUp={(event) => {
              if (dragging) paintWheel(event);
              setDragging(false);
              try {
                event.currentTarget.releasePointerCapture(event.pointerId);
              } catch {
                // pointer capture may already be released
              }
            }}
            onPointerCancel={() => setDragging(false)}
            role="application"
            aria-label="Colour wheel: drag to set the main hue and saturation"
          >
            {draft.colors.map((color, index) => {
              const position = wheelPosition(color);
              return (
                <span
                  key={`${index}-${color}`}
                  className={`wheel-marker ${index === 0 ? 'primary' : ''}`}
                  style={{ left: `${position.x}%`, top: `${position.y}%`, background: color }}
                />
              );
            })}
          </div>
          <span className="tiny faint">Drag the wheel to set the main hue and saturation.</span>
        </div>

        <div className="grow stack sm">
          <Field label="Derivation">
            <div className="seg" style={{ width: '100%' }}>
              {COLOR_DERIVATION_MODES.map((mode) => (
                <button
                  key={mode}
                  className={draft.derivation === mode ? 'active' : ''}
                  onClick={() => setDerivation(mode)}
                >
                  {DERIVATION_LABELS[mode]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Harmony">
            <div className="custom-harmony-grid">
              {COLOR_HARMONY_MODES.map((harmony) => (
                <button
                  key={harmony}
                  className={`btn sm ${draft.harmony === harmony ? 'primary' : ''}`}
                  onClick={() => setHarmony(harmony)}
                >
                  {HARMONY_LABELS[harmony]}
                </button>
              ))}
            </div>
          </Field>

          <div className="custom-base-colors">
            {draft.baseColors.map((color, index) => (
              <label className="custom-color-field" key={index}>
                <span className="tiny faint">{index === 0 ? 'Main color' : `Tone ${index + 1}`}</span>
                <div className="row" style={{ gap: 5 }}>
                  <input
                    type="color"
                    value={color}
                    onChange={(event) => setBaseColor(index, event.target.value)}
                  />
                  <code>{color}</code>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="custom-swatches">
        {draft.colors.map((color, index) => (
          <label className="custom-swatch" key={index}>
            <input
              type="color"
              value={color}
              onChange={(event) => setSwatch(index, event.target.value)}
              aria-label={`Set ${SWATCH_LABELS[index]} colour`}
            />
            <span>{SWATCH_LABELS[index]}</span>
            <code>{color}</code>
          </label>
        ))}
      </div>

      <div className="row between">
        <span className="tiny faint">
          Editing a swatch overrides it; Regenerate restores the harmony scheme.
        </span>
        <button className="btn sm" onClick={regenerate}>
          <Icon name="refresh" size={13} /> Regenerate
        </button>
      </div>
    </div>
  );
}
