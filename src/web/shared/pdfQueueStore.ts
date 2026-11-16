import type { PdfMetadataMode } from '../../shared/constants';

/**
 * Persistence for the browser-side PDF ingestion queue.
 *
 * Files waiting to be uploaded live only in memory, so a page reload would
 * otherwise lose them. We keep them in IndexedDB (Blob is structured-cloneable)
 * and resume queued uploads on the next visit. Finished items keep their row but
 * drop the Blob so they do not consume storage.
 */
export interface StoredPdfQueueItem {
  id: string;
  name: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  title?: string;
  refId?: string;
  error?: string;
  mode: PdfMetadataMode | null;
  projectId: string | null;
  createdAt: number;
  blob?: Blob;
}

const DB_NAME = 'loom-queues';
const DB_VERSION = 1;
const STORE = 'pdf-ingest';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function listPdfQueue(): Promise<StoredPdfQueueItem[]> {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => {
        const rows = (request.result as StoredPdfQueueItem[]).slice();
        rows.sort((a, b) => a.createdAt - b.createdAt);
        resolve(rows);
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function savePdfQueueItem(item: StoredPdfQueueItem): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deletePdfQueueItem(id: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteFinishedPdfQueueItems(): Promise<void> {
  const rows = await listPdfQueue();
  await Promise.all(
    rows
      .filter((row) => row.status === 'done' || row.status === 'failed')
      .map((row) => deletePdfQueueItem(row.id)),
  );
}
