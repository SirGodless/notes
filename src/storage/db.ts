import type { NotesDocument } from '../model/types';

/**
 * Duenner IndexedDB-Wrapper. Bewusst ohne Bibliothek – es sind zwei Stores
 * und vier Operationen.
 *
 * Warum nicht localStorage: dort landet alles als String, mit ~5 MB Limit.
 * Ein Dokument mit ein paar hundert handgeschriebenen Zeilen sprengt das.
 * IndexedDB speichert ausserdem strukturiert, das JSON.stringify faellt weg.
 */

const DB_NAME = 'notes-db';
const DB_VERSION = 1;
const DOC_STORE = 'documents';
const META_STORE = 'meta';
const LAST_OPENED_KEY = 'lastOpenedDocumentId';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOC_STORE)) db.createObjectStore(DOC_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = work(transaction.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

export async function saveDocument(doc: NotesDocument): Promise<void> {
  await runTransaction(DOC_STORE, 'readwrite', (store) => store.put(doc));
  await runTransaction(META_STORE, 'readwrite', (store) => store.put(doc.id, LAST_OPENED_KEY));
}

export async function loadDocument(id: string): Promise<NotesDocument | null> {
  const result = await runTransaction<NotesDocument | undefined>(DOC_STORE, 'readonly', (store) =>
    store.get(id),
  );
  return result ?? null;
}

export async function loadLastOpenedDocument(): Promise<NotesDocument | null> {
  const id = await runTransaction<string | undefined>(META_STORE, 'readonly', (store) =>
    store.get(LAST_OPENED_KEY),
  );
  if (!id) return null;
  return loadDocument(id);
}

export async function listDocuments(): Promise<Array<Pick<NotesDocument, 'id' | 'title' | 'updatedAt'>>> {
  const all = await runTransaction<NotesDocument[]>(DOC_STORE, 'readonly', (store) => store.getAll());
  return all
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteDocument(id: string): Promise<void> {
  await runTransaction(DOC_STORE, 'readwrite', (store) => store.delete(id));
}
