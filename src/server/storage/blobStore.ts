import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../core/errors';
import { newId } from '../core/ids';

export interface StoredBlob {
  hash: string;
  size: number;
}

export interface Range {
  start: number;
  end: number;
}

export interface BlobStore {
  saveFile(tempFile: string, maxBytes?: number): Promise<StoredBlob>;
  createReadStream(hash: string, range?: Range): Readable;
  stat(hash: string): Promise<{ size: number } | null>;
  remove(hash: string): Promise<void>;
  list(): Promise<string[]>;
  tempPath(prefix?: string): string;
  pathFor(hash: string): string;
  cleanupTemp(maxAgeMs?: number): Promise<number>;
}

export class LocalBlobStore implements BlobStore {
  constructor(
    private readonly root: string,
    private readonly tmpRoot: string,
  ) {}

  pathFor(hash: string): string {
    return path.join(this.root, hash.slice(0, 2), hash.slice(2, 4), hash);
  }

  tempPath(prefix = 'blob'): string {
    return path.join(this.tmpRoot, `${prefix}-${newId('tmp')}`);
  }

  async saveFile(tempFile: string, maxBytes?: number): Promise<StoredBlob> {
    const stat = await fs.stat(tempFile);
    if (maxBytes !== undefined && stat.size > maxBytes) {
      await fs.rm(tempFile, { force: true });
      throw new AppError('payload_too_large', 'The file exceeds the upload limit.');
    }
    if (stat.size === 0) {
      await fs.rm(tempFile, { force: true });
      throw new AppError('bad_request', 'The file is empty.');
    }
    const hash = await hashFile(tempFile);
    const dest = this.pathFor(hash);
    await fs.mkdir(path.dirname(dest), { recursive: true, mode: 0o750 });
    try {
      await fs.access(dest);
      await fs.rm(tempFile, { force: true });
    } catch {
      await fs.rename(tempFile, dest);
      await fs.chmod(dest, 0o640).catch(() => undefined);
    }
    return { hash, size: stat.size };
  }

  createReadStream(hash: string, range?: Range): Readable {
    return createReadStream(this.pathFor(hash), range);
  }

  async stat(hash: string): Promise<{ size: number } | null> {
    try {
      const stat = await fs.stat(this.pathFor(hash));
      return { size: stat.size };
    } catch {
      return null;
    }
  }

  async remove(hash: string): Promise<void> {
    await fs.rm(this.pathFor(hash), { force: true });
  }

  async list(): Promise<string[]> {
    const hashes: string[] = [];
    let firstLevel: string[];
    try {
      firstLevel = await fs.readdir(this.root);
    } catch {
      return [];
    }
    for (const a of firstLevel) {
      if (a.length !== 2) continue;
      let secondLevel: string[];
      try {
        secondLevel = await fs.readdir(path.join(this.root, a));
      } catch {
        continue;
      }
      for (const b of secondLevel) {
        if (b.length !== 2) continue;
        const dir = path.join(this.root, a, b);
        try {
          const entries = await fs.readdir(dir);
          for (const file of entries) {
            if (/^[a-f0-9]{64}$/.test(file)) hashes.push(file);
          }
        } catch {
          continue;
        }
      }
    }
    return hashes;
  }

  async cleanupTemp(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    let removed = 0;
    const cutoff = Date.now() - maxAgeMs;
    let entries: string[];
    try {
      entries = await fs.readdir(this.tmpRoot);
    } catch {
      return 0;
    }
    for (const entry of entries) {
      const file = path.join(this.tmpRoot, entry);
      try {
        const stat = await fs.stat(file);
        if (stat.mtimeMs < cutoff) {
          await fs.rm(file, { force: true, recursive: true });
          removed++;
        }
      } catch {
        continue;
      }
    }
    return removed;
  }
}

export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/** Stream a request body to a temp file, enforcing a byte cap. Returns path and size. */
export async function writeStreamToFile(
  stream: Readable,
  file: string,
  maxBytes: number,
): Promise<{ size: number }> {
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      size += chunk.length;
      if (size > maxBytes) {
        callback(new AppError('payload_too_large', 'The upload exceeds the limit.'));
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(stream, counter, createWriteStream(file, { mode: 0o600 }));
  } catch (error) {
    await fs.rm(file, { force: true });
    throw error;
  }
  return { size };
}
