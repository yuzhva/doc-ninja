import { FileSystemBridge } from './file-system-bridge';

const DB_NAME = 'DocNinja';
const DB_VERSION = 2;
const STORE_NAME = 'docTemplates';
const OUTPUT_DIRECTORY_STORE_NAME = 'docmOutputDirectory';

// This store only ever holds one record — the folder generated .doc* files
// get written into. Keyed by a constant rather than by a generated id so
// saving a new pick overwrites the previous one instead of accumulating.
const OUTPUT_DIRECTORY_RECORD_ID = 'current';

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

/**
 * The remembered output folder. Only a `FileSystemDirectoryHandle` (which,
 * like a file handle, is structured-cloneable and so survives IndexedDB) plus
 * the display name — deliberately NOT the picker's full result, whose scanned
 * file entries carry `getFileContent` functions IndexedDB cannot serialize.
 *
 * The handle survives a restart; the *permission* granted on it does not —
 * Chromium resets it to 'prompt', and re-granting needs a user gesture. That
 * re-grant deliberately happens on the generate click (see
 * verifyOutputDirectoryIsWritable), never at load time, where there is no
 * gesture for it to attach to.
 */
interface StoredOutputDirectoryRecord {
  id: string;
  name: string;
  browserDirectoryHandle: FileSystemDirectoryHandle;
}

// Memoized so repeated calls (one per list/save/remove) reuse the same
// connection instead of opening a fresh one every time.
let dbPromise: Promise<IDBDatabase> | null = null;

const openDatabase = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Guarded rather than unconditional: this one handler runs both for a
      // fresh v0 -> v2 create and for the v1 -> v2 upgrade of a database that
      // already has the templates store, where re-creating it would throw a
      // ConstraintError and take the whole (already-working) template
      // persistence down with it.
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(OUTPUT_DIRECTORY_STORE_NAME)) {
        db.createObjectStore(OUTPUT_DIRECTORY_STORE_NAME, { keyPath: 'id' });
      }
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
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> =>
  openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const store = db.transaction(storeName, mode).objectStore(storeName);
        const request = run(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );

// Handles go through FileSystemBridge.reviveStoredHandle on the way out: the
// desktop app's own handles come back from IndexedDB as plain fields.
const listStoredTemplates = async (): Promise<StoredTemplateRecord[]> => {
  const records = await withStore<StoredTemplateRecord[], unknown>(
    STORE_NAME,
    'readonly',
    (store) => store.getAll(),
  );
  return records.map((record) => ({
    ...record,
    browserFileHandle: FileSystemBridge.reviveStoredHandle(
      record.browserFileHandle,
    ),
  }));
};

const saveStoredTemplate = async (
  record: StoredTemplateRecord,
): Promise<void> => {
  await withStore(STORE_NAME, 'readwrite', (store) => store.put(record));
};

const removeStoredTemplate = async (id: string): Promise<void> => {
  await withStore(STORE_NAME, 'readwrite', (store) => store.delete(id));
};

/** Resolves undefined when no folder has been remembered yet. */
const readStoredOutputDirectory = async (): Promise<
  StoredOutputDirectoryRecord | undefined
> => {
  const record = await withStore<
    StoredOutputDirectoryRecord | undefined,
    unknown
  >(OUTPUT_DIRECTORY_STORE_NAME, 'readonly', (store) =>
    store.get(OUTPUT_DIRECTORY_RECORD_ID),
  );
  return (
    record && {
      ...record,
      browserDirectoryHandle: FileSystemBridge.reviveStoredHandle(
        record.browserDirectoryHandle,
      ),
    }
  );
};

const saveStoredOutputDirectory = async (
  record: Omit<StoredOutputDirectoryRecord, 'id'>,
): Promise<void> => {
  await withStore(OUTPUT_DIRECTORY_STORE_NAME, 'readwrite', (store) =>
    store.put({ ...record, id: OUTPUT_DIRECTORY_RECORD_ID }),
  );
};

const removeStoredOutputDirectory = async (): Promise<void> => {
  await withStore(OUTPUT_DIRECTORY_STORE_NAME, 'readwrite', (store) =>
    store.delete(OUTPUT_DIRECTORY_RECORD_ID),
  );
};

export {
  listStoredTemplates,
  saveStoredTemplate,
  removeStoredTemplate,
  readStoredOutputDirectory,
  saveStoredOutputDirectory,
  removeStoredOutputDirectory,
};
export type { StoredOutputDirectoryRecord, StoredTemplateRecord };
