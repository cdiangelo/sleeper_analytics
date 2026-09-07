/**
 * Minimal fetch wrapper shared by the browser app and the Node dump script.
 * Sleeper publishes no rate limit but does throttle bursts, so every call gets
 * a timeout and bounded retries with backoff.
 */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface GetOptions {
  /** Per-attempt timeout in ms. */
  timeoutMs?: number;
  /** Retries after the first attempt. */
  retries?: number;
  /** Return null instead of throwing on 404. */
  nullOn404?: boolean;
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getJSON<T>(url: string, opts: GetOptions = {}): Promise<T> {
  const { timeoutMs = 15_000, retries = 3, nullOn404 = false, signal } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(2 ** attempt * 250);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener("abort", onOuterAbort, { once: true });

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });

      if (res.status === 404 && nullOn404) return null as T;

      // 4xx other than 429 will not fix themselves; fail fast.
      if (!res.ok && res.status < 500 && res.status !== 429) {
        throw new HttpError(`${res.status} ${res.statusText}`, res.status, url);
      }
      if (!res.ok) {
        lastError = new HttpError(`${res.status} ${res.statusText}`, res.status, url);
        continue;
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      if (signal?.aborted) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onOuterAbort);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Request failed after ${retries + 1} attempts: ${url}`);
}
