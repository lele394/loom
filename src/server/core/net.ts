import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from './errors';

const PRIVATE_V4 = [
  [0, 0, 0, 0, 8],
  [10, 0, 0, 0, 8],
  [100, 64, 0, 0, 10],
  [127, 0, 0, 0, 8],
  [169, 254, 0, 0, 16],
  [172, 16, 0, 0, 12],
  [192, 0, 0, 0, 24],
  [192, 168, 0, 0, 16],
  [198, 18, 0, 0, 15],
  [224, 0, 0, 0, 4],
  [240, 0, 0, 0, 4],
] as const;

function v4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const value = v4ToInt(ip);
    return PRIVATE_V4.some(([a, b, c, d, bits]) => {
      const base = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
      const mask = (~0 << (32 - bits)) >>> 0;
      return (value & mask) === (base & mask);
    });
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('ff')) return true;
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      if (isIP(mapped) === 4) return isPrivateAddress(mapped);
    }
    return false;
  }
  return true;
}

export interface SafeFetchResult {
  finalUrl: string;
  contentType: string;
  body: string;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new AppError('bad_request', 'This URL is not allowed.');
    return;
  }
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new AppError('bad_request', 'This URL is not allowed.');
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) throw new AppError('bad_request', 'Could not resolve that URL.');
  for (const address of addresses) {
    if (isPrivateAddress(address.address)) {
      throw new AppError('bad_request', 'This URL is not allowed.');
    }
  }
}

export async function safeFetch(
  rawUrl: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {},
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 3;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new AppError('bad_request', 'Invalid URL.');
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new AppError('bad_request', 'Only http(s) URLs are supported.');
    }
    await assertPublicHost(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'Loom/0.1 (+research notebook)', accept: 'text/html,application/pdf;q=0.8' },
      });
    } catch (error) {
      clearTimeout(timer);
      if ((error as Error).name === 'AbortError') {
        throw new AppError('provider_timeout', 'The URL took too long to respond.');
      }
      throw new AppError('bad_request', 'Could not fetch that URL.');
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      clearTimeout(timer);
      const location = response.headers.get('location');
      if (!location) throw new AppError('bad_request', 'The URL redirected without a destination.');
      current = new URL(location, current);
      continue;
    }

    if (!response.ok) {
      clearTimeout(timer);
      throw new AppError('bad_request', `The URL returned HTTP ${response.status}.`);
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/pdf')) {
      clearTimeout(timer);
      throw new AppError('unsupported_file', 'Only HTML pages and PDFs can be captured from a URL.');
    }

    if (contentType.includes('application/pdf')) {
      const buffer = await readCapped(response, maxBytes, controller);
      clearTimeout(timer);
      return { finalUrl: current.toString(), contentType: 'application/pdf', body: buffer.toString('latin1') };
    }

    const bytes = await readCapped(response, maxBytes, controller);
    clearTimeout(timer);
    const html = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return { finalUrl: current.toString(), contentType: 'text/html', body: html };
  }

  throw new AppError('bad_request', 'Too many redirects.');
}

async function readCapped(response: Response, maxBytes: number, controller: AbortController): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw new AppError('payload_too_large', 'The page is too large to capture.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/** Extract title/description/author from HTML without executing anything. */
export function extractPageMetadata(html: string): {
  title: string;
  description: string;
  authors: string[];
  publishedAt: string | null;
} {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const meta = (name: string): string => {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`,
      'i',
    );
    const alt = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`,
      'i',
    );
    return decodeEntities(re.exec(html)?.[1] ?? alt.exec(html)?.[1] ?? '');
  };
  const title = decodeEntities(titleMatch?.[1] ?? '') || meta('og:title');
  const description = meta('description') || meta('og:description');
  const authorRaw = meta('author') || meta('citation_author') || meta('article:author');
  const dateRaw = meta('citation_publication_date') || meta('article:published_time') || '';
  const dateMatch = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(dateRaw);
  const publishedAt = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2] ?? '01'}-${dateMatch[3] ?? '01'}`
    : null;
  return {
    title: title.replace(/\s+/g, ' ').trim().slice(0, 500),
    description: description.replace(/\s+/g, ' ').trim().slice(0, 50_000),
    authors: authorRaw
      .split(/\s*(?:;|\band\b)\s*/i)
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 50),
    publishedAt,
  };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '');
}

/** Strip a page down to readable text for AI metadata extraction (bounded). */
export function extractReadableText(html: string, maxChars = 14_000): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ');
  const text = decodeEntities(withoutNoise.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxChars);
}
