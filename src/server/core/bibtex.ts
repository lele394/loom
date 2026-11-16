export interface BibEntry {
  entryType: string;
  citeKey: string;
  fields: Record<string, string>;
}

function readBraced(input: string, start: number): { value: string; end: number } {
  let depth = 0;
  let value = '';
  let i = start;
  for (; i < input.length; i++) {
    const char = input[i]!;
    if (char === '{') {
      depth++;
      if (depth === 1) continue;
    }
    if (char === '}') {
      depth--;
      if (depth === 0) return { value, end: i + 1 };
    }
    value += char;
  }
  return { value, end: i };
}

export function parseBibtex(input: string): { entries: BibEntry[]; errors: string[] } {
  const entries: BibEntry[] = [];
  const errors: string[] = [];
  let position = 0;

  while (position < input.length) {
    const at = input.indexOf('@', position);
    if (at < 0) break;
    const header = /^@([a-zA-Z]+)\s*([{(])/.exec(input.slice(at));
    if (!header) {
      position = at + 1;
      continue;
    }
    const type = header[1]!.toLowerCase();
    if (['comment', 'preamble', 'string'].includes(type)) {
      position = at + header[0].length;
      continue;
    }
    const open = header[2]!;
    const close = open === '{' ? '}' : ')';
    let i = at + header[0].length;
    const keyMatch = /^\s*([^,\s]+)\s*,/.exec(input.slice(i));
    if (!keyMatch) {
      errors.push(`Missing citation key near position ${at}.`);
      position = i;
      continue;
    }
    const citeKey = keyMatch[1]!;
    i += keyMatch[0].length;
    const fields: Record<string, string> = {};
    let depth = 1;

    while (i < input.length && depth > 0) {
      while (i < input.length && /[\s,]/.test(input[i]!)) i++;
      if (i >= input.length) break;
      if (input[i] === close) {
        depth--;
        i++;
        break;
      }
      const nameMatch = /^([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*/.exec(input.slice(i));
      if (!nameMatch) {
        i++;
        continue;
      }
      const name = nameMatch[1]!.toLowerCase();
      i += nameMatch[0].length;
      let value = '';
      if (input[i] === '{') {
        const braced = readBraced(input, i);
        value = braced.value;
        i = braced.end;
      } else if (input[i] === '"') {
        i++;
        const start = i;
        let escaped = false;
        while (i < input.length) {
          const char = input[i]!;
          if (char === '"' && !escaped) break;
          escaped = char === '\\' && !escaped;
          i++;
        }
        value = input.slice(start, i);
        i++;
      } else {
        const start = i;
        while (i < input.length && !/[,}\n]/.test(input[i]!)) i++;
        value = input.slice(start, i).trim();
      }
      fields[name] = cleanLatex(value);
      while (i < input.length && /\s/.test(input[i]!)) i++;
      if (input[i] === ',') i++;
    }

    if (Object.keys(fields).length) {
      entries.push({ entryType: type, citeKey, fields });
    }
    position = Math.max(i, at + 1);
  }

  return { entries, errors };
}

function cleanLatex(value: string): string {
  return value
    .replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\&/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitAuthors(value: string): string[] {
  if (!value) return [];
  return value
    .split(/\s+and\s+/i)
    .map((author) => {
      const trimmed = author.trim();
      if (!trimmed) return '';
      if (trimmed.includes(',')) {
        const [last, ...rest] = trimmed.split(',').map((part) => part.trim());
        return [rest.join(' '), last].filter(Boolean).join(' ').trim();
      }
      return trimmed;
    })
    .filter(Boolean);
}

export function formatBibtex(reference: {
  citeKey: string;
  type: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  doi: string | null;
  url: string | null;
  abstract: string;
  publishedAt: string | null;
  extra: Record<string, unknown>;
}): string {
  const typeMap: Record<string, string> = {
    article: 'article',
    inproceedings: 'inproceedings',
    book: 'book',
    website: 'misc',
    report: 'techreport',
    thesis: 'phdthesis',
    preprint: 'misc',
    other: 'misc',
  };
  const fields: [string, string][] = [];
  if (reference.authors.length) {
    fields.push(['author', reference.authors.join(' and ')]);
  }
  fields.push(['title', reference.title]);
  if (reference.venue) {
    fields.push([reference.type === 'article' ? 'journal' : 'booktitle', reference.venue]);
  }
  if (reference.year) fields.push(['year', String(reference.year)]);
  if (reference.doi) fields.push(['doi', reference.doi]);
  if (reference.url) fields.push(['url', reference.url]);
  if (reference.abstract) fields.push(['abstract', reference.abstract]);
  if (reference.publishedAt) fields.push(['date', reference.publishedAt]);
  for (const [key, value] of Object.entries(reference.extra)) {
    if (typeof value === 'string' && value.trim()) fields.push([key.toLowerCase(), value]);
  }
  return `@${typeMap[reference.type] ?? 'misc'}{${reference.citeKey},\n${fields
    .map(([key, value]) => `  ${key} = {${value.replace(/[{}]/g, '')}}`)
    .join(',\n')}\n}\n`;
}
