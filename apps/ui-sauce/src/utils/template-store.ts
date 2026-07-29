const DB_NAME = 'DocNinja';
const DB_VERSION = 1;
const STORE_NAME = 'docTemplates';

interface StoredTemplateRecord {
  id: string;
  name: string;
  // Dedup key — "./filename" (the closest stable proxy available in the
  // sandboxed File System Access API, for privacy reasons — no real
  // filesystem path is ever exposed to this app, Electron included, since
  // FileSystemBridge.pickFile always uses the native picker).
  path: string;
  addedAt: number;
  browserFileHandle: FileSystemFileHandle;
  // Last-known-good copy of the template's bytes, refreshed on every
  // successful live read — used as a fallback when the handle can no longer
  // be resolved (file deleted, moved, or renamed).
  cachedContent?: Blob;
}

// Memoized so repeated calls (one per list/save/remove) reuse the same
// connection instead of opening a fresh one every time.
let dbPromise: Promise<IDBDatabase> | null = null;

const openDatabase = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab wants to upgrade this database (DB_VERSION bumped) —
      // release our connection so it isn't blocked waiting on us forever,
      // and forget it so the next call here opens a fresh one.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      // Don't cache a failed open — let the next call retry from scratch.
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
};

const withStore = <T, _>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> =>
  openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const store = db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
        const request = run(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );

const listStoredTemplates = (): Promise<StoredTemplateRecord[]> =>
  withStore('readonly', (store) => store.getAll());

const saveStoredTemplate = async (
  record: StoredTemplateRecord,
): Promise<void> => {
  await withStore('readwrite', (store) => store.put(record));
};

const removeStoredTemplate = async (id: string): Promise<void> => {
  await withStore('readwrite', (store) => store.delete(id));
};

export { listStoredTemplates, saveStoredTemplate, removeStoredTemplate };
export type { StoredTemplateRecord };
