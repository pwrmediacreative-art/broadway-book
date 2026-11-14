// The phone's saved copy (IndexedDB): every published chart, plus a small key/value area for
// sync state and saved setlists. Every call rejects when the browser refuses storage
// (private browsing, storage full); callers treat that as "not saved".

const NAME = "bb-offline";
export const SONGS = "songs"; // keyPath: slug
export const KV = "kv"; // out-of-line string keys

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("storage unavailable"));
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(NAME, 1);
    } catch (e) {
      return reject(e as Error);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SONGS)) db.createObjectStore(SONGS, { keyPath: "slug" });
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      db.onclose = () => {
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("storage blocked"));
    req.onblocked = () => reject(new Error("storage blocked"));
  });
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

const wait = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("storage failed"));
  });

const finish = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("storage failed"));
  });

export async function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await open();
  return wait(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function dbAll<T>(store: string): Promise<T[]> {
  const db = await open();
  return wait(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

export async function dbKeys(store: string): Promise<string[]> {
  const db = await open();
  return (await wait(db.transaction(store).objectStore(store).getAllKeys())) as string[];
}

/** Save and remove chart rows in one transaction (all or nothing). */
export async function dbWriteSongs(puts: { slug: string }[], deletes: string[] = []): Promise<void> {
  if (!puts.length && !deletes.length) return;
  const db = await open();
  const tx = db.transaction(SONGS, "readwrite");
  const os = tx.objectStore(SONGS);
  puts.forEach((p) => os.put(p));
  deletes.forEach((d) => os.delete(d));
  await finish(tx);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  const tx = db.transaction(KV, "readwrite");
  tx.objectStore(KV).put(value, key);
  await finish(tx);
}

export async function kvDel(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const db = await open();
  const tx = db.transaction(KV, "readwrite");
  keys.forEach((k) => tx.objectStore(KV).delete(k));
  await finish(tx);
}

export const kvGet = <T>(key: string) => dbGet<T>(KV, key);
