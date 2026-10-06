import type { HttpOptions } from "./http.js";

/**
 * Official daily open/close for US stocks from Stooq's free CSV endpoint (no key).
 * Used only as ground truth for the scorecard: what the exchange actually printed.
 */
export interface DailyBar { date: string; open: number; high: number; low: number; close: number }

export function parseStooqCsv(csv: string): DailyBar[] {
  const lines = csv.trim().split(/\r?\n/);
  if (!lines.length || !/^date/i.test(lines[0])) return [];
  return lines.slice(1).map((l) => {
    const [date, o, h, lo, c] = l.split(",");
    return { date, open: Number(o), high: Number(h), low: Number(lo), close: Number(c) };
  }).filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.date) && Number.isFinite(b.open) && Number.isFinite(b.close));
}

export async function stooqDaily(ticker: string, opts: HttpOptions = {}): Promise<DailyBar[]> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker.toLowerCase())}.us&i=d`;
  const res = await (opts.fetchImpl ?? fetch)(url);
  if (!res.ok) throw new Error(`stooq ${ticker}: HTTP ${res.status}`);
  return parseStooqCsv(await res.text());
}
