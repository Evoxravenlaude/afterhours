import type { TokenQuote, ExternalSignal, FairValue, Dislocation } from "./types.js";

export interface ModelConfig {
  /** Weight on the independent 24/7 signal when it is fresh (0..1). Tokens get the rest. */
  externalWeight: number;
  /** A signal older than this is ignored. */
  maxSignalAgeMs: number;
  /** Token prices further than this from the token median are dropped as broken or stale. */
  outlierPct: number;
  /** Residual hourly log-volatility used to widen the band as signals age. */
  hourlyVol: number;
  /** Band half-width = z × combined uncertainty. */
  z: number;
  /** Narrowest band allowed, as a fraction (0.0025 = 0.25%). */
  minHalfWidth: number;
}

export const DEFAULT_MODEL: ModelConfig = {
  externalWeight: 0.7,
  maxSignalAgeMs: 10 * 60_000,
  outlierPct: 0.1,
  hourlyVol: 0.004,
  z: 2,
  minHalfWidth: 0.0025,
};

/**
 * Price of one underlying share implied by a token: one raw token represents `multiplier` shares,
 * corrected by the token's learned basis (its normal premium or discount while the exchange is open).
 */
export function sharePrice(q: Pick<TokenQuote, "tokenPrice" | "multiplier"> & { basis?: number }): number {
  if (!(q.multiplier > 0)) throw new Error("multiplier must be > 0");
  return q.tokenPrice / q.multiplier / (q.basis && q.basis > 0 ? q.basis : 1);
}

/**
 * Learn a token's basis from paired observations taken while the exchange is open:
 * the median ratio of the token's per-share price to the real price. Needs enough points and a sane result.
 */
export function estimateBasis(pairs: { tokenShare: number; truth: number }[], opts: { minPoints?: number; maxDeviation?: number } = {}): number | undefined {
  const { minPoints = 6, maxDeviation = 0.1 } = opts;
  const r = pairs.filter((p) => p.tokenShare > 0 && p.truth > 0).map((p) => p.tokenShare / p.truth).sort((a, b) => a - b);
  if (r.length < minPoints) return undefined;
  const m = r.length % 2 ? r[r.length >> 1] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2;
  return Math.abs(m - 1) <= maxDeviation ? m : undefined;
}

function weightedMedian(values: { v: number; w: number }[]): number {
  const s = [...values].sort((a, b) => a.v - b.v);
  const total = s.reduce((a, x) => a + x.w, 0);
  let acc = 0;
  for (const x of s) { acc += x.w; if (acc >= total / 2) return x.v; }
  return s[s.length - 1].v;
}

/** Liquidity-weighted median of per-share prices across issuers, with broken quotes dropped. */
export function tokenConsensus(quotes: TokenQuote[], cfg: ModelConfig = DEFAULT_MODEL): { value: number; used: TokenQuote[] } | null {
  if (!quotes.length) return null;
  const pts = quotes.map((q) => ({ q, v: sharePrice(q), w: Math.max(1, q.liquidityUsd ?? 1) }));
  const rough = weightedMedian(pts.map(({ v, w }) => ({ v, w })));
  const kept = pts.filter((p) => Math.abs(p.v / rough - 1) <= cfg.outlierPct);
  if (!kept.length) return null;
  return { value: weightedMedian(kept.map(({ v, w }) => ({ v, w }))), used: kept.map((p) => p.q) };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Robust spread of the sources (median absolute deviation, scaled to a normal sigma).
 * A single mispriced token must not widen the band enough to hide itself.
 */
function robustSpread(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

export interface FairValueInput {
  ticker: string;
  now: number;
  lastClose: number;
  lastCloseAt: number;
  hoursClosed: number;
  quotes: TokenQuote[];
  external?: ExternalSignal;
}

/**
 * Fair value per share while the exchange is closed.
 * A log-space blend of an independent 24/7 signal (e.g. a liquid perp) and the cross-issuer token consensus,
 * anchored to the last official close when neither is available. The band widens with source disagreement
 * and with the age of the freshest signal.
 */
export function fairValue(inp: FairValueInput, cfg: ModelConfig = DEFAULT_MODEL): FairValue {
  const cons = tokenConsensus(inp.quotes, cfg);
  const ext = inp.external && inp.now - inp.external.observedAt <= cfg.maxSignalAgeMs ? inp.external : undefined;

  let we = 0, wt = 0;
  if (ext && cons) { we = cfg.externalWeight; wt = 1 - we; }
  else if (ext) { we = 1; }
  else if (cons) { wt = 1; }

  const lc = Math.log(inp.lastClose);
  const logFv = we + wt === 0
    ? lc
    : lc + we * (ext ? Math.log(ext.price) - lc : 0) + wt * (cons ? Math.log(cons.value) - lc : 0);
  const value = we + wt === 0 ? inp.lastClose : Math.exp(logFv);

  const sourceLogs: number[] = [];
  if (ext) sourceLogs.push(Math.log(ext.price));
  if (cons) for (const q of cons.used) sourceLogs.push(Math.log(sharePrice(q)));
  const dispersion = robustSpread(sourceLogs);

  const freshest = Math.max(ext?.observedAt ?? 0, ...(cons?.used.map((q) => q.observedAt) ?? [0]));
  const staleHours = freshest ? Math.max(0, (inp.now - freshest) / 3_600_000) : inp.hoursClosed;
  const residual = cfg.hourlyVol * Math.sqrt(Math.max(staleHours, we + wt === 0 ? inp.hoursClosed : 0));
  const half = Math.max(cfg.minHalfWidth, cfg.z * Math.sqrt(dispersion ** 2 + residual ** 2));

  return {
    ticker: inp.ticker,
    at: inp.now,
    lastClose: inp.lastClose,
    lastCloseAt: inp.lastCloseAt,
    value,
    low: value * Math.exp(-half),
    high: value * Math.exp(half),
    inputs: { tokenConsensus: cons?.value, external: ext?.price, weights: { external: we, tokens: wt }, sigma: half / cfg.z, hoursClosed: inp.hoursClosed },
  };
}

export interface CostModel {
  /** Round-trip-ish cost to act on a dislocation, as a fraction: DEX fee + expected slippage. */
  costPct: (q: TokenQuote) => number;
  /** Minimum edge after costs before we bother anyone. */
  minNetEdgePct: number;
}

export const DEFAULT_COSTS: CostModel = { costPct: () => 0.0025 + 0.003, minNetEdgePct: 0.003 };

/** Tokens trading outside the fair-value band by more than costs. */
export function findDislocations(fv: FairValue, quotes: TokenQuote[], costs: CostModel = DEFAULT_COSTS): Dislocation[] {
  const out: Dislocation[] = [];
  for (const q of quotes) {
    const sp = sharePrice(q);
    if (sp >= fv.low && sp <= fv.high) continue;
    const edge = sp / fv.value - 1;
    const net = Math.abs(edge) - costs.costPct(q);
    if (net < costs.minNetEdgePct) continue;
    out.push({
      ticker: fv.ticker, issuer: q.issuer, symbol: q.symbol, contract: q.contract,
      sharePrice: sp, fairValue: fv.value, edgePct: edge, netEdgePct: net,
      side: edge < 0 ? "buy" : "sell", at: fv.at,
    });
  }
  return out.sort((a, b) => b.netEdgePct - a.netEdgePct);
}
