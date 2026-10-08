import type { HttpOptions } from "./http.js";
import { stooqDaily, type DailyBar } from "./stooq.js";

/**
 * Ground truth for the scorecard: what the exchange actually printed.
 * Yahoo's chart endpoint first (daily and 15-minute bars, no key), Nasdaq's historical endpoint second,
 * Stooq last (it returned 403 from GitHub Codespaces on 2026-10-08).
 */
const UA = { "User-Agent": "Mozilla/5.0 (compatible; afterhours-backtest/1.0)", Accept: "application/json,text/plain,*/*" };

export interface IntradayBar { t: number; o: number; c: number }

function etDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

export function parseYahooChart(j: any): { daily: DailyBar[]; intraday: IntradayBar[]; granularity?: string } {
  const r = j?.chart?.result?.[0];
  const ts: number[] = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const g: string | undefined = r?.meta?.dataGranularity;
  const rows = ts.map((t, i) => ({ t: t * 1000, o: Number(q.open?.[i]), h: Number(q.high?.[i]), l: Number(q.low?.[i]), c: Number(q.close?.[i]) }))
    .filter((x) => Number.isFinite(x.o) && Number.isFinite(x.c) && x.o > 0 && x.c > 0);
  if (g === "1d") return { daily: rows.map((x) => ({ date: etDate(x.t), open: x.o, high: x.h, low: x.l, close: x.c })), intraday: [], granularity: g };
  return { daily: [], intraday: rows.map((x) => ({ t: x.t, o: x.o, c: x.c })), granularity: g };
}

export function parseNasdaqHistorical(j: any): DailyBar[] {
  const rows: any[] = j?.data?.tradesTable?.rows ?? [];
  const n = (s: string) => Number(String(s).replace(/[$,]/g, ""));
  return rows.map((r) => {
    const [m, d, y] = String(r.date).split("/");
    return { date: `${y}-${m}-${d}`, open: n(r.open), high: n(r.high), low: n(r.low), close: n(r.close) };
  }).filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.date) && b.open > 0 && b.close > 0);
}

async function json(url: string, opts: HttpOptions) {
  const res = await (opts.fetchImpl ?? fetch)(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

export async function dailyBars(ticker: string, opts: HttpOptions = {}): Promise<{ bars: DailyBar[]; source: string }> {
  const errors: string[] = [];
  try {
    const d = parseYahooChart(await json(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=6mo`, opts)).daily;
    if (d.length) return { bars: d, source: "yahoo" };
  } catch (e) { errors.push(String(e)); }
  for (const cls of ["stocks", "etf"]) {
    try {
      const from = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10), to = new Date().toISOString().slice(0, 10);
      const d = parseNasdaqHistorical(await json(`https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/historical?assetclass=${cls}&fromdate=${from}&todate=${to}&limit=200`, opts));
      if (d.length) return { bars: d, source: `nasdaq-${cls}` };
    } catch (e) { errors.push(String(e)); }
  }
  try {
    const d = await stooqDaily(ticker, opts);
    if (d.length) return { bars: d, source: "stooq" };
  } catch (e) { errors.push(String(e)); }
  throw new Error(`no daily bars for ${ticker}: ${errors.map((e) => e.slice(0, 80)).join(" | ")}`);
}

/** 15-minute regular-session bars for the last ~60 days (Yahoo), used to learn each token's basis. */
export async function intradayBars(ticker: string, opts: HttpOptions = {}): Promise<IntradayBar[]> {
  return parseYahooChart(await json(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=15m&range=60d`, opts)).intraday;
}
