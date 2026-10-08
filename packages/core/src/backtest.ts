import type { Issuer, TokenQuote, ExternalSignal, Dislocation } from "./types.js";
import { issuerClosed } from "./guard.js";
import { fairValue, findDislocations, DEFAULT_MODEL, DEFAULT_COSTS, type ModelConfig, type CostModel } from "./model.js";
import type { Forecast } from "./scorer.js";
import { shouldRealert } from "./guard.js";

export interface Candle { t: number; c: number; v?: number }

export interface TokenSeries { issuer: Issuer; symbol: string; contract: `0x${string}`; multiplier: number; basis?: number; candles: Candle[] }

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

/**
 * Binance k-lines skip intervals with no trades, so a quiet token's last candle can be hours old.
 * `fresh` quotes (recent trades) shape fair value; `held` quotes carry the last traded price forward
 * so a token left behind while fair value moves can still be flagged.
 */
function snapshot(p: PeriodInput, t: number, maxAge: number, holdMs: number): { fresh: TokenQuote[]; held: TokenQuote[]; external?: ExternalSignal } {
  const fresh: TokenQuote[] = [], held: TokenQuote[] = [];
  for (const s of p.tokens) {
    const k = at(s.candles, t, holdMs);
    if (!k) continue;
    const q = { issuer: s.issuer, symbol: s.symbol, ticker: p.ticker, contract: s.contract, tokenPrice: k.c, multiplier: s.multiplier, basis: s.basis, liquidityUsd: k.v, observedAt: k.t };
    held.push(q);
    if (t - k.t <= maxAge) fresh.push(q);
  }
  const e = p.external ? at(p.external, t, maxAge) : undefined;
  return { fresh, held, external: e ? { source: "hyperliquid", ticker: p.ticker, price: e.c, observedAt: e.t } : undefined };
}

/**
 * Replay one closed period from historical candles.
 * Forecast: our fair value `leadMs` before the open, plus the token-only variant, scored later against the official open.
 * Alerts: every `stepMs` through the closed period, deduplicated per token and side; each is valued at the open.
 */
export function backtestPeriod(p: PeriodInput, opts: { stepMs?: number; leadMs?: number; maxCandleAgeMs?: number; holdMs?: number; model?: ModelConfig; costs?: CostModel } = {}): PeriodResult {
  const { stepMs = 15 * 60_000, leadMs = 5 * 60_000, maxCandleAgeMs = 2 * 3_600_000, holdMs = 24 * 3_600_000, model = DEFAULT_MODEL, costs = DEFAULT_COSTS } = opts;
  const tf = p.openAt - leadMs;
  const snap0 = snapshot(p, tf, maxCandleAgeMs, holdMs);
  const s = { quotes: snap0.fresh, external: snap0.external };
  const hours = (tf - p.lastCloseAt) / 3_600_000;
  const base = { ticker: p.ticker, now: tf, lastClose: p.lastClose, lastCloseAt: p.lastCloseAt, hoursClosed: hours };
  const fv = fairValue({ ...base, quotes: s.quotes, external: s.external }, { ...model, maxSignalAgeMs: maxCandleAgeMs });
  const tok = fairValue({ ...base, quotes: s.quotes }, { ...model, maxSignalAgeMs: maxCandleAgeMs });

  const seen = new Map<string, { at: number; netEdgePct: number }>();
  const inBandAt = new Map<string, number>();
  const alerts: BacktestAlert[] = [];
  for (let t = p.lastCloseAt + stepMs; t < p.openAt; t += stepMs) {
    const snap = snapshot(p, t, maxCandleAgeMs, holdMs);
    if (!snap.held.length || (!snap.fresh.length && !snap.external)) continue;
    const f = fairValue({ ticker: p.ticker, now: t, lastClose: p.lastClose, lastCloseAt: p.lastCloseAt, hoursClosed: (t - p.lastCloseAt) / 3_600_000, quotes: snap.fresh, external: snap.external }, { ...model, maxSignalAgeMs: maxCandleAgeMs });
    const out = findDislocations(f, snap.held.filter((q) => !issuerClosed(q.issuer, t)), costs);
    for (const q of snap.held) if (!out.some((d) => d.contract === q.contract)) inBandAt.set(q.contract, t);
    for (const d of out) {
      const key = `${d.contract}:${d.side}`;
      if (!shouldRealert(seen.get(key), d, inBandAt.get(d.contract) ?? 0)) continue;
      seen.set(key, { at: d.at, netEdgePct: d.netEdgePct });
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
