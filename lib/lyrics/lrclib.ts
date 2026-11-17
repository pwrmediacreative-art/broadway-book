import "server-only";

// LRCLIB client (https://lrclib.net/docs). Follows its client rules:
// * identifies the app (name, version, homepage) in the User-Agent;
// * one request at a time, with a pause between requests;
// * on 429 waits the Retry-After seconds (+ up to 30% jitter) before one retry.
// Nothing is stored: results go straight back to the caller.
import type { LyricsRecord } from "./match";

const BASE = "https://lrclib.net/api";
export const USER_AGENT = "BroadwayBook/1.0 (+https://github.com/pwrmediacreative-art/broadway-book)";
const GAP_MS = 400;
const TIMEOUT_MS = 8000;
const MAX_RETRY_WAIT_S = 10; // a longer Retry-After fails now instead of holding the queue
const MAX_WAITING = 8; // requests queued on this server instance before new ones fail fast

let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;
let waiting = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs requests one after another, at least GAP_MS apart (per server instance). */
function queued<T>(fn: () => Promise<T>): Promise<T> {
  if (waiting >= MAX_WAITING) return Promise.reject(new Error("LRCLIB queue is full"));
  waiting++;
  const run = chain.then(async () => {
    const wait = lastAt + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastAt = Date.now();
      waiting--;
    }
  });
  chain = run.catch(() => {});
  return run;
}

async function call(path: string, retried = false): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": USER_AGENT, "Lrclib-Client": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (res.status === 429 && !retried) {
    const h = res.headers.get("retry-after") ?? "";
    const after = /^\d+$/.test(h) ? Number(h) : Math.max(0, (Date.parse(h) - Date.now()) / 1000) || 2;
    if (after > MAX_RETRY_WAIT_S) throw new Error(`LRCLIB asked to wait ${after}s`);
    await sleep(after * 1000 * (1 + Math.random() * 0.3));
    return call(path, true);
  }
  return res;
}

/** 404 = no such track (null). Any other failure throws, so callers report an error
 *  (and phones keep their saved copy) instead of "No lyrics found". */
const json = async <T>(res: Response): Promise<T | null> => {
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return (await res.json()) as T;
};

/** Exact lookup by title + artist; null when LRCLIB has no such track. */
export const getTrack = (title: string, artist: string) =>
  queued(async () => json<LyricsRecord>(await call(`/get?${new URLSearchParams({ track_name: title, artist_name: artist })}`)));

/** One record by its LRCLIB id. */
export const getById = (id: number) => queued(async () => json<LyricsRecord>(await call(`/get/${encodeURIComponent(String(id))}`)));

/** Up to 20 candidates for title (+ artist when known). */
export const searchTracks = (title: string, artist: string | null) =>
  queued(async () => {
    const q = new URLSearchParams({ track_name: title });
    if (artist) q.set("artist_name", artist);
    return (await json<LyricsRecord[]>(await call(`/search?${q}`))) ?? [];
  });
