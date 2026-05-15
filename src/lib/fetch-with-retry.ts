/**
 * Resilient fetch wrapper for upstream ATS APIs (Greenhouse, Lever,
 * Ashby, SmartRecruiters, Workday, custom careers pages).
 *
 * Why we need this
 * ────────────────
 * The fetchers were calling `fetch()` directly with `signal:
 * AbortSignal.timeout(15000)` and throwing on any `!res.ok`. That
 * conflated three very different failure modes:
 *
 *   1. **Permanent**: the board no longer exists on this ATS
 *      (Coinbase migrated off Greenhouse, Nutanix migrated off Ashby).
 *      Always 404. Retrying makes the next refresh slower and
 *      pollutes the error log without ever succeeding.
 *
 *   2. **Transient**: 5xx, 429 (rate-limited), network blip, DNS
 *      hiccup, ATS-side timeout. These usually clear after a brief
 *      wait — exactly the case a retry should handle.
 *
 *   3. **Caller bug**: 400-class other than 404/429 (auth, bad token,
 *      malformed query). Won't be fixed by retrying.
 *
 * Strategy
 * ────────
 *   - GET + AbortSignal.timeout — same shape as the direct fetches it
 *     replaces, so call sites only change one line.
 *   - Retries: up to `retries` attempts (default 2 retries → 3 total)
 *     with jittered exponential backoff. Only retries the transient
 *     bucket: network errors, AbortError (timeout), HTTP 5xx, HTTP 429.
 *   - Permanent failures (404, other 4xx) throw immediately on the
 *     first attempt — no backoff delay added to the dead-source path.
 *   - Error messages include the status AND a hint about likely cause
 *     so the user sees "Coinbase: Greenhouse board removed (404)"
 *     instead of just "HTTP 404".
 *
 * Signal handling: callers can pass their own AbortSignal which is
 * `AbortSignal.any()`-merged with the per-attempt timeout signal so
 * a parent cancellation always wins.
 */

export interface FetchWithRetryOptions {
  /** Per-attempt timeout in ms. Default 15000. */
  timeoutMs?: number;
  /** Max number of retry attempts after the first failure. Default 2
   *  (so 3 total attempts on transient failures). */
  retries?: number;
  /** Base backoff in ms — actual delay is `base * 2^attempt + jitter`.
   *  Default 500ms → ~500ms, ~1000ms between the three attempts. */
  backoffMs?: number;
  /** Caller's cancellation signal. Combined with the per-attempt
   *  timeout signal so cancellations propagate immediately. */
  signal?: AbortSignal;
  /** Optional source name for clearer error messages
   *  ("Greenhouse: HTTP 404" → "Coinbase (Greenhouse): board removed (404)"). */
  sourceName?: string;
  /** Optional ATS family — used to hint at the likely cause when a
   *  board returns 404 ("looks like <name> migrated off <ats>"). */
  atsName?: string;
}

/** Status codes that justify a retry. Anything else (or a thrown
 *  exception that's NOT a network/abort error) fails immediately. */
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 522, 524]);

export class HttpError extends Error {
  status: number;
  /** True when this represents a permanent "the board is gone"
   *  outcome — caller can use it to optimize (e.g. flag the source
   *  for an admin to clean up, skip retries upstream). */
  isDead: boolean;
  constructor(status: number, message: string, isDead: boolean) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.isDead = isDead;
  }
}

function describeStatus(
  status: number,
  sourceName?: string,
  atsName?: string,
): string {
  const prefix = sourceName ? `${sourceName}${atsName ? ` (${atsName})` : ''}: ` : '';
  if (status === 404) {
    // 404 from an ATS list endpoint nearly always means the company
    // moved off that ATS — the token used to be valid but the board
    // got deleted. The user fix is to find the new token or remove the
    // source entirely; retrying won't help.
    return `${prefix}board not found (404) — likely migrated off ${atsName ?? 'this ATS'}`;
  }
  if (status === 429) return `${prefix}rate limited (429)`;
  if (status >= 500) return `${prefix}upstream error (${status})`;
  return `${prefix}HTTP ${status}`;
}

function jitter(ms: number): number {
  // ±25% jitter — keeps stampedes from synchronizing when many
  // fetchers retry at the same instant.
  return ms * (0.75 + Math.random() * 0.5);
}

/**
 * Drop-in replacement for `fetch(url, { signal: AbortSignal.timeout(...) })`
 * with retry on transient failures and structured error messages on
 * permanent failures.
 *
 * Returns the `Response` so callers can call `.json()` / `.text()` /
 * `.ok` checks themselves — same shape as plain fetch. On a permanent
 * failure throws `HttpError`. On exhausted retries throws the last
 * underlying error (also wrapped as `HttpError` when status-based).
 */
export async function fetchWithRetry(
  url: string,
  opts: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 15000,
    retries = 2,
    backoffMs = 500,
    signal: callerSignal,
    sourceName,
    atsName,
  } = opts;

  let lastError: Error | null = null;
  const totalAttempts = retries + 1;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    // Compose the per-attempt timeout with the caller's cancellation
    // signal. AbortSignal.any was added in Node 20 + modern browsers —
    // Next 16 / React 19 ships with that floor.
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal
      ? AbortSignal.any([timeoutSignal, callerSignal])
      : timeoutSignal;

    try {
      const res = await fetch(url, { signal });
      if (res.ok) return res;

      // Permanent failure: 4xx (except 408/429) → throw immediately,
      // do NOT consume a retry slot.
      if (!TRANSIENT_STATUSES.has(res.status)) {
        throw new HttpError(
          res.status,
          describeStatus(res.status, sourceName, atsName),
          res.status === 404 || res.status === 410,
        );
      }

      // Transient HTTP status — fall through to retry path.
      lastError = new HttpError(
        res.status,
        describeStatus(res.status, sourceName, atsName),
        false,
      );
    } catch (err) {
      // Permanent errors bubble up immediately.
      if (err instanceof HttpError && !TRANSIENT_STATUSES.has(err.status)) {
        throw err;
      }
      // Caller cancellation is also permanent — respect it.
      if (callerSignal?.aborted) throw err;
      // Anything else (AbortError from per-attempt timeout, network
      // errors, DNS, TLS) is treated as transient.
      lastError = err as Error;
    }

    // Last attempt? Don't sleep again, just bail.
    if (attempt === totalAttempts - 1) break;

    const delay = jitter(backoffMs * Math.pow(2, attempt));
    await new Promise((r) => setTimeout(r, delay));
  }

  // Exhausted retries — surface the last error with a clear message.
  if (lastError instanceof HttpError) throw lastError;
  const msg = sourceName
    ? `${sourceName}${atsName ? ` (${atsName})` : ''}: ${lastError?.message ?? 'fetch failed'} after ${totalAttempts} attempts`
    : `${lastError?.message ?? 'fetch failed'} after ${totalAttempts} attempts`;
  throw new Error(msg);
}
