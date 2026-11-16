import { AppError } from './errors';

export interface PdfExtraction {
  pageCount: number;
  pages: string[];
  text: string;
  pageMap: { page: number; start: number; end: number }[];
  doi: string | null;
}

const MAX_PDF_BYTES = 40 * 1024 * 1024;
const MAX_PAGES = 2000;

/** Extract page text + a DOI candidate from a PDF buffer. Shared by attachments and literature ingest. */
export async function extractPdf(buffer: Buffer): Promise<PdfExtraction> {
  if (buffer.length > MAX_PDF_BYTES) {
    throw new AppError('unsupported_file', 'This PDF is too large to extract (40 MB limit).');
  }
  const { extractText, getDocumentProxy } = (await import('unpdf')) as {
    extractText: (
      pdf: unknown,
      opts: { mergePages: boolean },
    ) => Promise<{ totalPages: number; text: string[] | string }>;
    getDocumentProxy: (data: Uint8Array) => Promise<unknown>;
  };
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pageCount = (pdf as { numPages?: number }).numPages ?? 0;
  if (pageCount > MAX_PAGES) {
    throw new AppError('unsupported_file', 'This PDF has too many pages to index (2,000 page limit).');
  }
  const result = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(result.text) ? result.text : [result.text];

  let offset = 0;
  const pageMap: { page: number; start: number; end: number }[] = [];
  let fullText = '';
  pages.forEach((pageText, index) => {
    const start = offset;
    fullText += pageText;
    offset += pageText.length;
    pageMap.push({ page: index + 1, start, end: offset });
    fullText += '\n\n';
    offset += 2;
  });

  const doiMatch = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i.exec(fullText.slice(0, 20_000));
  return {
    pageCount: pages.length,
    pages,
    text: fullText,
    pageMap,
    doi: doiMatch?.[0]?.replace(/[.,;]+$/, '') ?? null,
  };
}
