import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError } from './errors';

const execFile = promisify(execFileCallback);

export interface RenderedPdfPage {
  path: string;
  base64: string;
  mime: 'image/jpeg';
}

/**
 * Render the first pages of a PDF to JPEG using poppler's pdftoppm.
 * Requires poppler-utils on the host; the Docker image installs it.
 */
export async function withPdfImages<T>(
  buffer: Buffer,
  tmpRoot: string,
  fn: (pages: RenderedPdfPage[]) => Promise<T>,
  options: { maxPages?: number; dpi?: number } = {},
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(tmpRoot, 'pdfimg-'));
  const pdfPath = path.join(dir, 'input.pdf');
  const prefix = path.join(dir, 'page');
  try {
    await fs.writeFile(pdfPath, buffer);
    try {
      await execFile(
        'pdftoppm',
        [
          '-jpeg',
          '-r',
          String(options.dpi ?? 120),
          '-f',
          '1',
          '-l',
          String(options.maxPages ?? 3),
          pdfPath,
          prefix,
        ],
        { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError(
          'unsupported_file',
          'Image/OCR mode requires poppler-utils (pdftoppm) on the server. Install it or use text mode.',
        );
      }
      throw new AppError('unsupported_file', `Could not render PDF pages: ${(error as Error).message}`);
    }
    const files = (await fs.readdir(dir))
      .filter((file) => /^page-\d+\.jpg$/.test(file))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const pages: RenderedPdfPage[] = [];
    for (const file of files) {
      const filePath = path.join(dir, file);
      pages.push({
        path: filePath,
        base64: (await fs.readFile(filePath)).toString('base64'),
        mime: 'image/jpeg',
      });
    }
    if (!pages.length) throw new AppError('unsupported_file', 'No PDF pages could be rendered.');
    return await fn(pages);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Local OCR via Tesseract when installed. Returns null when unavailable. */
export async function ocrWithTesseract(imagePaths: string[]): Promise<string | null> {
  try {
    await execFile('tesseract', ['--version'], { timeout: 10_000 });
  } catch {
    return null;
  }
  try {
    const parts: string[] = [];
    for (const imagePath of imagePaths) {
      const { stdout } = await execFile('tesseract', [imagePath, 'stdout', '-l', 'eng'], {
        timeout: 60_000,
        maxBuffer: 12 * 1024 * 1024,
      });
      const text = stdout.replace(/\f/g, '\n').trim();
      if (text) parts.push(text);
    }
    const text = parts.join('\n\n').trim();
    return text || null;
  } catch {
    return null;
  }
}
