import type { Issuer, TokenQuote, ExternalSignal, Dislocation } from "./types.js";
import { fairValue, findDislocations, DEFAULT_MODEL, DEFAULT_COSTS, type ModelConfig, type CostModel } from "./model.js";
import type { Forecast } from "./scorer.js";

export interface Candle { t: number; c: number; v?: number }

export interface TokenSeries { issuer: Issuer; symbol: string; contract: `0x${string}`; multiplier: number; candles: Candle[] }

export interface PeriodInput {
  ticker: string;
  lastClose: number;
  lastCloseAt: number;
  openAt: number;
  actualOpen: number;
  tokens: TokenSeries[];
  external?: Candle[];
}

export interface BacktestAlert extends Dislocation { worthPct: number }

export interface PeriodResult {
  forecast: Forecast & { external?: number };
  alerts: BacktestAlert[];
}

/** Latest candle at or before t, if it isn't older than maxAge. */
function at(c: Candle[], t: number, maxAge: number): Candle | undefined {
  let best: Candle | undefined;
  for (const x of c) { if (x.t <= t && (!best || x.t > best.t)) best = x; }
  return best && t - best.t <= maxAge ? best : undefined;
}

function snapshot(p: PeriodInput, t: number, maxAge: number): { quotes: TokenQuote[]; external?: ExternalSignal } {
  const quotes: TokenQuote[] = [];
  for (const s of p.tokens) {
    const k = at(s.candles, t, maxAge);
    if (k) quotes.push({ issuer: s.issuer, symbol: s.symbol, ticker: p.ticker, contract: s.contract, tokenPrice: k.c, multiplier: s.multiplier, liquidityUsd: k.v, observedAt: k.t });
  }
  const e = p.external ? at(p.external, t, maxAge) : undefined;
  return { quotes, external: e ? { source: "hyperliquid", ticker: p.ticker, price: e.c, observedAt: e.t } : undefined };
}

/**
 * Replay one closed period from historical candles.
 * Forecast: our fair value `leadMs` before the open, plus the token-only variant, scored later against the official open.
 * Alerts: every `stepMs` through the closed period, deduplicated per token and side; each is valued at the open.
 */
export function backtestPeriod(p: PeriodInput, opts: { stepMs?: number; leadMs?: number; maxCandleAgeMs?: number; model?: ModelConfig; costs?: CostModel } = {}): PeriodResult {
  const { stepMs = 15 * 60_000, leadMs = 5 * 60_000, maxCandleAgeMs = 30 * 60_000, model = DEFAULT_MODEL, costs = DEFAULT_COSTS } = opts;
  const tf = p.openAt - leadMs;
  const s = snapshot(p, tf, maxCandleAgeMs);
  const hours = (tf - p.lastCloseAt) / 3_600_000;
  const base = { ticker: p.ticker, now: tf, lastClose: p.lastClose, lastCloseAt: p.lastCloseAt, hoursClosed: hours };
  const fv = fairValue({ ...base, quotes: s.quotes, external: s.external }, { ...model, maxSignalAgeMs: maxCandleAgeMs });
  const tok = fairValue({ ...base, quotes: s.quotes }, { ...model, maxSignalAgeMs: maxCandleAgeMs });

  const seen = new Map<string, number>();
  const alerts: BacktestAlert[] = [];
  for (let t = p.lastCloseAt + stepMs; t < p.openAt; t += stepMs) {
    const snap = snapshot(p, t, maxCandleAgeMs);
    if (!snap.quotes.length) continue;
    const f = fairValue({ ticker: p.ticker, now: t, lastClose: p.lastClose, lastCloseAt: p.lastCloseAt, hoursClosed: (t - p.lastCloseAt) / 3_600_000, quotes: snap.quotes, external: snap.external }, { ...model, maxSignalAgeMs: maxCandleAgeMs });
    for (const d of findDislocations(f, snap.quotes, costs)) {
      const key = `${d.contract}:${d.side}`;
      const prev = seen.get(key);
      if (prev !== undefined && d.netEdgePct < prev * 1.5) continue;
      seen.set(key, d.netEdgePct);
      const worthPct = d.side === "buy" ? p.actualOpen / d.sharePrice - 1 : d.sharePrice / p.actualOpen - 1;
      alerts.push({ ...d, worthPct });
    }
  }

  return {
    forecast: { ticker: p.ticker, periodStart: p.lastCloseAt, openAt: p.openAt, lastClose: p.lastClose, fairValue: fv.value, tokenOnly: s.quotes.length ? tok.value : undefined, external: s.external?.price, actualOpen: p.actualOpen },
    alerts,
  };
}

/** Summary of alert outcomes: share that were worth acting on at the open, and the average value. */
export function alertOutcomes(alerts: BacktestAlert[], costPct = DEFAULT_COSTS.costPct({} as TokenQuote)) {
  if (!alerts.length) return { n: 0, winRate: 0, avgWorthPct: 0, avgNetPct: 0 };
  const net = alerts.map((a) => a.worthPct - costPct);
  return {
    n: alerts.length,
    winRate: net.filter((x) => x > 0).length / alerts.length,
    avgWorthPct: alerts.reduce((s, a) => s + a.worthPct, 0) / alerts.length,
    avgNetPct: net.reduce((s, x) => s + x, 0) / alerts.length,
  };
}
