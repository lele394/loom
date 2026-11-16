# ADR 0009 — CSS design tokens instead of Tailwind

**Status:** Accepted

## Context

Theming (6 palettes × light/dark/system + custom accents) is a P0 product feature. The source design suggested Tailwind CSS. Theme correctness depends on every component consuming semantic tokens; utility classes encourage hard-coded palette values.

## Decision

- Hand-written CSS with semantic custom properties (`--surface`, `--text`, `--accent`, …).
- Palettes are `[data-theme="…"][data-mode="…"]` blocks of token values.
- Components use tokens and a small set of reusable classes; no CSS-in-JS, no utility framework.
- A pre-paint inline script applies theme/mode from localStorage.
- Accent overrides compute derived tokens in JS with a contrast check.

## Consequences

- Theme switching is a data attribute change; no component knows about colors.
- Small dependency surface and full control of density, focus and motion.
- More CSS authorship; mitigated by a shared component layer and a strict class naming convention (`ui-*`, `page-*`, feature prefixes).
- No Tailwind ecosystem/plugins; acceptable.

## Alternatives rejected

- **Tailwind:** fast to write, but dark/pastel token discipline is harder and the config/build adds a moving part.
- **CSS-in-JS:** runtime cost and another dependency; themes become code.
- **Component library (MUI/Chakra):** visual identity and token model would fight the requirement.
