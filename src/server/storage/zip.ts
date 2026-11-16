import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

const MAX_ENTRIES = 200_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024 * 1024;

/** Extract a ZIP safely: no traversal, no absolute paths, no symlinks, bounded size. */
export async function extractZip(zipPath: string, outDir: string): Promise<number> {
  await fs.mkdir(outDir, { recursive: true });
  let entries = 0;
  let total = 0;

  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(openError ?? new Error('Could not open archive.'));
        return;
      }
      const fail = (error: Error) => {
        zip.close();
        reject(error);
      };
      zip.on('error', fail);
      zip.on('end', () => resolve(entries));
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          try {
            entries++;
            if (entries > MAX_ENTRIES) throw new Error('Archive has too many entries.');
            total += entry.uncompressedSize;
            if (total > MAX_TOTAL_BYTES) throw new Error('Archive is too large when expanded.');
            const name = entry.fileName.replace(/\\/g, '/');
            if (name.includes('\0')) throw new Error('Invalid entry name.');
            if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..')) {
              throw new Error(`Unsafe archive entry: ${name}`);
            }
            const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
            if (mode === 0o120000) throw new Error('Symbolic links are not allowed in archives.');
            const target = path.resolve(outDir, name);
            if (target !== outDir && !target.startsWith(path.resolve(outDir) + path.sep)) {
              throw new Error('Archive entry escapes the target directory.');
            }
            if (name.endsWith('/')) {
              await fs.mkdir(target, { recursive: true });
              zip.readEntry();
              return;
            }
            await fs.mkdir(path.dirname(target), { recursive: true });
            const stream = await new Promise<NodeJS.ReadableStream>((res, rej) =>
              zip.openReadStream(entry, (error, readStream) => {
                if (error || !readStream) rej(error ?? new Error('Could not read archive entry.'));
                else res(readStream);
              }),
            );
            await pipeline(stream, createWriteStream(target, { mode: 0o600 }));
            zip.readEntry();
          } catch (error) {
            fail(error as Error);
          }
        })();
      });
      zip.readEntry();
    });
  });
}
