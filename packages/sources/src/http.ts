export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  /** Injected in tests to replay recorded responses. */
  fetchImpl?: typeof fetch;
}

export class HttpError extends Error {
  constructor(public status: number, public url: string, public body: string) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
  }
}

export async function getJson<T = unknown>(url: string, opts: HttpOptions & { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const { timeoutMs = 10_000, retries = 2, headers = {}, fetchImpl = fetch, method = "GET", body } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method, signal: ctrl.signal,
        headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, url, text);
      return JSON.parse(text) as T;
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) break;
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

/** Numbers arrive as strings, numbers, or null. Anything not finite becomes undefined. */
export function num(x: unknown): number | undefined {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : undefined;
}
