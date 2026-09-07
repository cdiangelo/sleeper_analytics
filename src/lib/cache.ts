/**
 * Caching with explicit staleness.
 *
 * Every cached value carries the wall-clock time it was fetched, and the UI
 * renders that age. During games the difference between a 30-second-old score
 * and a 20-minute-old one is the whole story, so freshness is never implied —
 * it is always displayed.
 *
 * localStorage holds the small responses. The player index is far too big for
 * it and lives in IndexedDB.
 */

const PREFIX = "gg:";
const DB_NAME = "gridiron-gurus";
const DB_VERSION = 1;
const STORE = "blobs";

export interface Cached<T> {
  data: T;
  fetchedAt: number;
}

export type Freshness = "live" | "fresh" | "stale" | "expired";

export interface Staleness {
  ageMs: number;
  label: string;
  freshness: Freshness;
}

/** Cadence per resource, from spec §2. */
export const TTL = {
  state: 5 * 60_000,
  league: 24 * 60 * 60_000,
  users: 24 * 60 * 60_000,
  rosters: 60 * 60_000,
  /** During games this is the one that matters. */
  matchupsLive: 60_000,
  matchupsFinal: 24 * 60 * 60_000,
  transactions: 60 * 60_000,
  draft: 60 * 60_000,
  trending: 60 * 60_000,
  projections: 12 * 60 * 60_000,
  players: 7 * 24 * 60 * 60_000,
} as const;

export function describeAge(fetchedAt: number, now = Date.now()): Staleness {
  const ageMs = Math.max(0, now - fetchedAt);
  const sec = Math.round(ageMs / 1000);

  let label: string;
  if (sec < 10) label = "just now";
  else if (sec < 60) label = `${sec}s ago`;
  else if (sec < 3600) label = `${Math.round(sec / 60)}m ago`;
  else if (sec < 86_400) label = `${Math.round(sec / 3600)}h ago`;
  else label = `${Math.round(sec / 86_400)}d ago`;

  const freshness: Freshness =
    ageMs < 90_000
      ? "live"
      : ageMs < 10 * 60_000
        ? "fresh"
        : ageMs < 60 * 60_000
          ? "stale"
          : "expired";

  return { ageMs, label, freshness };
}

// --- localStorage -----------------------------------------------------------

function safeLocalStorage(): Storage | null {
  try {
    const ls = globalThis.localStorage;
    const probe = `${PREFIX}__probe`;
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    // Private mode, disabled site data, or a non-browser host.
    return null;
  }
}

export function readCache<T>(key: string): Cached<T> | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached<T>;
    if (typeof parsed?.fetchedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T): Cached<T> {
  const entry: Cached<T> = { data, fetchedAt: Date.now() };
  const ls = safeLocalStorage();
  try {
    ls?.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota exceeded — evict everything we own and let the next write retry.
    clearCache();
  }
  return entry;
}

export function clearCache(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  for (const key of Object.keys(ls)) {
    if (key.startsWith(PREFIX)) ls.removeItem(key);
  }
}

/**
 * Serve from cache when inside the TTL, otherwise fetch and store.
 *
 * On a failed refresh the stale value is returned rather than throwing: a
 * twenty-minute-old score labelled as such beats an error screen. `error` is
 * set so the UI can say why the age is not moving.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  opts: { force?: boolean } = {},
): Promise<Cached<T> & { error?: Error }> {
  const hit = readCache<T>(key);
  const fresh = hit && !opts.force && Date.now() - hit.fetchedAt < ttlMs;
  if (fresh) return hit;

  try {
    return writeCache(key, await fetcher());
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (hit) return { ...hit, error };
    throw error;
  }
}

// --- IndexedDB (player index) ----------------------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
  });
}

async function idbTransact<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

export async function readBlob<T>(key: string): Promise<Cached<T> | null> {
  try {
    const hit = await idbTransact<Cached<T> | undefined>("readonly", (s) => s.get(key));
    return hit && typeof hit.fetchedAt === "number" ? hit : null;
  } catch {
    return null;
  }
}

export async function writeBlob<T>(key: string, data: T): Promise<Cached<T>> {
  const entry: Cached<T> = { data, fetchedAt: Date.now() };
  try {
    await idbTransact("readwrite", (s) => s.put(entry, key));
  } catch {
    // Non-fatal: the value stays in memory for this session.
  }
  return entry;
}

/** IndexedDB-backed equivalent of `cached`, for payloads too big for localStorage. */
export async function cachedBlob<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  opts: { force?: boolean } = {},
): Promise<Cached<T> & { error?: Error }> {
  const hit = await readBlob<T>(key);
  if (hit && !opts.force && Date.now() - hit.fetchedAt < ttlMs) return hit;

  try {
    return await writeBlob(key, await fetcher());
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (hit) return { ...hit, error };
    throw error;
  }
}
