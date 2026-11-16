# 09 — Frontend, UX and theming

## 1. Information architecture

```
/login, /setup
/                          Dashboard (global)
/inbox                     Quick-capture triage
/search?q=                 Global results
/journal, /journal/:date    Daily digest + diff
/activity                  Global timeline
/projects/:id              Project overview
/projects/:id/board        Kanban
/projects/:id/notes        Note list
/notes/:id                 Note editor
/projects/:id/literature   Reference list
/literature/:id            Reference detail
/projects/:id/experiments  Experiment list
/experiments/:id           Experiment detail
/projects/:id/questions    Research questions
/trash                     Soft-deleted objects
/settings                  Appearance, AI, backup, account, jobs
```

Global navigation (left rail): Dashboard, Inbox, Journal, Search, Activity; then Projects (with colour dots and counts); then Settings/Trash. The rail collapses into a drawer below 900 px.

Top bar: breadcrumb/project switcher, global search field (`Ctrl+K`), quick-capture button, theme toggle, user menu.

Right dock: **AI panel**, closed by default, expandable to 380 px from the topbar/rail sparkle button, then a full-height sheet on narrow screens. It does not overlay content while open on desktop.

## 2. Layout principles

- Research IDE, not project management SaaS: dense, calm, content-first.
- One accent per project (colour dot), pastels for tags/badges/surfaces, never for long text.
- Maximum content width 1 100 px for reading; boards and tables use full width.
- Cards radius 12 px, controls 8 px, 1 px borders, shadows only for overlays.
- Type scale: 12/13/14/16/20/26/34 px. Body 14 px, notes reading mode 16 px with 1.7 line-height. System font stack.
- Motion ≤ 160 ms, ease-out; all transitions disabled under `prefers-reduced-motion`.

## 3. Design tokens and theming

Tokens live on `:root` and are overridden by `[data-theme][data-mode]`. Components reference tokens only — no hard-coded colours.

```css
:root {
  --bg          page background
  --surface     cards, panels
  --surface-2   inputs, hover rows
  --surface-3   active/selected
  --text        primary ink
  --text-muted  secondary ink
  --text-faint  placeholders, metadata
  --border      hairlines
  --border-strong
  --accent      primary action / active nav
  --accent-hover
  --accent-soft pastel fill for badges
  --accent-contrast  text on accent
  --success --warning --danger --info (pastel fills + ink variants)
  --ring        focus ring
  --shadow      overlay shadow
  --radius, --radius-sm
  --font-ui, --font-reading
  --density     comfortable | compact
}
```

### Palettes

| Theme | Light | Dark |
| --- | --- | --- |
| **Lavender** | `bg #f7f5fa`, `surface #ffffff`, `accent #7c5cbf`, `accent-soft #ece5f7`, ink `#302c39` | `bg #14121b`, `surface #1d1a27`, `accent #b7a4ff`, ink `#ece9f4` |
| **Sakura** | `bg #fdf6f5`, `surface #ffffff`, `accent #b64f70`, soft `#f9e2e8`, ink `#3a2c30` | `bg #191216`, `surface #241a1f`, `accent #f2a2b8`, ink `#f3e9ec` |
| **Sage** | `bg #f4f7f2`, `surface #ffffff`, `accent #4f7a5b`, soft `#e2eee5`, ink `#2b3630` | `bg #101713`, `surface #1a231d`, `accent #9cc9a9`, ink `#e7efe9` |
| **Ocean** | `bg #f2f7fa`, `surface #ffffff`, `accent #327a96`, soft `#dcecf3`, ink `#26343a` | `bg #0e161c`, `surface #17232b`, `accent #86c5dd`, ink `#e5f0f5` |
| **Midnight** | *(theme defaults to dark; light variant navy-tinted)* `bg #eef0f7`, accent `#4c5bb5` | `bg #0d1020`, `surface #161a2e`, `accent #8fa2ff`, soft `#242b4d`, ink `#e8ebfa` |
| **Graphite** | `bg #f4f4f3`, `surface #ffffff`, `accent #6b6257`, soft `#e9e5df`, ink `#2d2b28` | `bg #161718`, `surface #202224`, `accent #d9b382`, soft `#2f2b25`, ink `#e9e6e1` |

Rules:
- Accent buttons use `--accent` with `--accent-contrast` (white in light themes; near-black in dark themes where accents are lighter).
- Body text must reach ≥ 4.5:1 against `--bg`/`--surface`; muted text ≥ 4.5:1 on surfaces (not on pastel fills unless verified).
- Pastel `--accent-soft` always pairs with `--text` or a darkened ink variant, never with white.
- A palette switch changes tokens only; no component-level theme logic.

### Mode handling

Three modes: `light`, `dark`, `system`. `system` reads `matchMedia('(prefers-color-scheme: dark)')` and live-updates.

No flash of wrong theme: a tiny inline script in `index.html` reads `localStorage.loom-appearance` before CSS paint and sets `data-theme`/`data-mode` on `<html>`. The server preference is applied after the session loads, but local storage is the source of truth for paint. When they differ, the server value wins and local storage is updated.

### Accent override

`PATCH /settings/appearance` accepts `accent` (hex). The client sets `--accent` and computes `--accent-hover` (darken/lighten 8%), `--accent-soft` (mix with background 82%), and `--accent-contrast` (white or #16161a by WCAG luminance). Text on soft fills uses `--text`. Settings shows a live preview and a contrast warning if the chosen accent cannot support readable `accent-contrast` text (falls back to outline button style).

## 4. Component inventory (shared)

`Button` (primary/secondary/ghost/danger, sizes), `IconButton`, `Input`, `Textarea`, `Select`, `Field` (label/help/error), `Checkbox`, `Switch`, `Badge`, `TagChip`, `Card`, `Panel`, `Modal`, `Drawer`, `Menu`, `Tabs`, `Tooltip` (title-based in v1), `EmptyState`, `Spinner`, `Skeleton`, `Toast`, `ConfirmDialog`, `Pagination`, `Markdown`, `DatePicker` (native date input), `ColorDot`, `Progress`, `Kbd`.

No third-party component library. This keeps theme tokens authoritative and the bundle small.

## 5. Key screens

### Dashboard

Greeting + date, capability banner if AI is not configured. Widgets: today's tasks (overdue/today), projects grid (counts, colour, last activity), inbox count, yesterday's digest preview with "open journal", recent activity (10), open questions. Widgets are a fixed grid with per-user visibility toggles stored in settings (P2 for reordering).

### Kanban

Columns from project config. Cards show title, priority dot, due chip, tags, checklist progress, link count. Native HTML5 drag-and-drop with keyboard alternative: focus card → `Space` picks up → arrows move → `Space` drops → `Esc` cancels. Move persists optimistically; failure reverts with a toast. Quick-add at the bottom of each column.

### Note editor

- Block list, each block a textarea rendered as Markdown when unfocused (click to edit). Markdown shortcuts at line start: `# `, `## `, `- `, `1. `, `> `, `[] `, ```` ``` ````, `$$ `.
- Enter creates a new block of the same type (except headings), Backspace at start merges with previous, `Alt+↑/↓` moves blocks, `/` opens a block-type menu, drag handle reorders.
- Toolbar: block type, bold/italic/code hints, link, insert reference/task by search, equation, callout.
- Autosave 800 ms after typing stops + flush on blur/tab-hide; status chip "Saved/Saving/Offline/Conflict".
- Conflict dialog: reload server version (discard local) or overwrite (force, snapshot kept).
- Right inspector: metadata (project, template, tags, created/updated), links/backlinks, versions, attachments, "Ask AI about this note".
- Word count and reading time in the footer.

### Literature

Table/list with title, authors/year, venue, status, tags, added date; filters in a toolbar; row opens detail. Detail: metadata form, reading status, rating, tags, abstract, notes, PDF viewer (iframe of the authenticated download with `#page=`), attachments, links/backlinks, "Ask AI", "Export BibTeX". Add dialog: URL / PDF / manual / BibTeX import tabs. Dropping one or more PDFs, or one or more URL links, anywhere on the Literature page starts AI metadata extraction with an inline progress banner; a single result opens its detail page, multiple results refresh the list. The PDF tab and URL tab use the same analyze-and-add flow, and a toolbar selector overrides the PDF input mode (`default`/`text`/`images`/`ocr`). The URL tab accepts one link per line (max 10). Web pages are archived as HTML attachments with searchable text. The literature table has per-row and select-all checkboxes; **Re-run extraction** opens a per-item mode dialog (OCR default) and feeds a metadata processing queue with queued/processing/done/failed dots; validated metadata is applied automatically. The reference page has **Redo metadata**, which prints the raw model output, parsed fields, OCR text and source preview, with an explicit Apply button. Personal notes, AI summaries, links and attachments each have dedicated side-panel cards; summaries can be regenerated with extra instructions. **Read mode** (`/literature/:id/read`) focuses the PDF alongside personal notes, AI summary, collapsible page bookmarks (page + ≤250-char note), and an optional AI chat panel. Firefox's built-in PDF editor annotations cannot be captured by an embedding page; the UI explains this and offers attaching an annotated PDF copy, while in-app bookmarks cover page-level notes.

### Experiments

List with status chips; detail is a structured form (objective, hypothesis, method, environment key/value editor, results markdown, metrics rows), attachments with CSV preview table (first 50 rows), links, "Compare with selection" AI action.

### Journal

Date navigator (prev/today/next), deterministic diff grouped by project with counts and item lists, AI summary panel (or CTA), "Regenerate", "Copy next steps", "Turn next steps into tasks" (parses checklist lines into task drafts). Staleness banner when events are newer than the digest.

### AI panel

Header: scope selector (Global / This project / Selection), context chips, new conversation, history. Body: messages, streaming indicator, citation chips, per-message actions (copy, save as note, extract tasks). Footer: textarea with send, token/cost hint, degraded-mode explanation. Source chips open the object anchor in a new view and highlight the cited block/page.

### Settings

Tabs: Appearance (mode, palette swatches, accent, density), AI (providers, test, model roles, privacy note), Data (export, backups, restore, trash), Jobs, Account (password, timezone, logout-all), About (version, paths, licenses).

## 6. State and data fetching

- `api.ts`: `get/post/patch/put/del` wrappers adding `X-CSRF-Token`, parsing the error envelope into `ApiError`, and a `stream()` helper for SSE.
- `useResource(key, fetcher)` returns `{data, error, loading, reload, mutate}`. No client cache beyond component lifetime; each screen fetches what it needs. This is intentional at personal scale.
- Toast context for transient feedback; confirm dialog for destructive actions.
- Three React contexts only: `SessionContext` (user, capabilities, CSRF), `AppearanceContext`, `AiContext` (open state, scope, selection chips).
- URL is state: filters live in query params where they matter (search, journal date, note id), so views are linkable and back/forward works.

## 7. Keyboard map

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd+K` | Command palette (actions + search) |
| `Ctrl/Cmd+Shift+Space` | Quick capture |
| `G` then `D/I/J/A` | Dashboard / Inbox / Journal / Activity |
| `N` | New note (current project) |
| `T` | New task (current project) |
| `?` | Shortcut help |
| `Esc` | Close overlay / cancel drag |
| `Ctrl/Cmd+Enter` | Send AI message / save note |

Shortcuts are ignored while typing in inputs except the global capture/palette combinations. `?` opens a modal listing all bindings (single source of truth in `hotkeys.ts`).

## 8. Accessibility

- Every interactive element is a real `button`/`a`/`input`, focus-visible ring using `--ring`.
- Modals trap focus, restore focus on close, close on `Esc`, labelled by title.
- Board drag-and-drop has the keyboard flow above; moves announce via `aria-live`.
- AI streaming text is announced politely at completion, not per token.
- Colour is never the only signal (priority has text/icon; status has label).
- Palettes verified for AA text contrast; accent overrides warn on failure.
- `prefers-reduced-motion` disables transforms/transitions.
- Images/PDF previews have text alternatives; citation chips include object type + title.
- Forms have labels, inline errors tied via `aria-describedby`.

## 9. Error, empty and loading states

Every list defines:
- **Loading:** skeleton rows (not a spinner for lists).
- **Empty:** one-sentence explanation + primary action.
- **Error:** message + retry, never a blank screen.
- **Degraded:** banner for AI unavailable, semantic search unavailable, extraction failed (per item).

A global error boundary catches render errors and offers reload + "copy diagnostics" (request ID, route, version).

## 10. Performance

- Route-level code splitting.
- Lists render at most 200 rows with "Load more"; no virtualization in v1.
- Search input debounced 250 ms, request cancellation via `AbortController`.
- Note autosave serialises requests (one in flight); no save storms.
- Bundle budget: initial JS ≤ 250 kB gzip (excluding PDF viewer; the PDF uses the browser's built-in viewer).
- Fonts: system only; no web font fetch.

## 11. Frontend folder contract

```
features/<name>/
  api.ts          typed calls for this feature (optional; small features use shared/api)
  components/     feature-local components
  <Page>.tsx
app/App.tsx       owns the route table; app/Shell owns the chrome
```

Cross-feature imports are allowed only from `shared/`, `app/` contexts, and another feature's `api.ts`, never its components. This keeps the dependency graph acyclic and features deletable. `scripts/check-boundaries.mjs` enforces it.
