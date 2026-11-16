import { createHash } from 'node:crypto';

export function slugify(input: string, max = 80): string {
  const base = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (base || 'untitled').slice(0, max).replace(/-+$/g, '');
}

export function sanitizeFilename(input: string, max = 120): string {
  const cleaned = input
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'file').slice(0, max);
}

export function truncate(input: string, max: number, suffix = '…'): string {
  if (input.length <= max) return input;
  return input.slice(0, Math.max(0, max - suffix.length)).trimEnd() + suffix;
}

export function excerpt(input: string, max = 180): string {
  const flat = input.replace(/\s+/g, ' ').trim();
  return truncate(flat, max);
}

export function estimateTokens(input: string): number {
  return Math.ceil(input.length / 4);
}

export function stripMarkup(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashText(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function uniqueCiteKey(base: string, exists: (key: string) => boolean): string {
  const clean = (base || 'ref').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 40) || 'ref';
  if (!exists(clean)) return clean;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${clean}${i}`;
    if (!exists(candidate)) return candidate;
  }
  return `${clean}${Date.now()}`;
}

export function authorLastName(author: string): string {
  const trimmed = author.trim();
  if (!trimmed) return '';
  if (trimmed.includes(',')) return trimmed.split(',')[0]!.trim();
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

export function buildCiteKey(authors: string[], year: number | null, title: string): string {
  const first = authorLastName(authors[0] ?? '') || 'anon';
  const word = slugify(title).split('-')[0] || 'ref';
  return `${first}${year ?? ''}${word}`.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 40);
}

/** Split long text into overlapping chunks on paragraph/sentence boundaries where possible. */
export function splitText(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf('\n'),
      );
      if (breakAt > size * 0.5) end = start + breakAt + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
