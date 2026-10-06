/**
 * The public scorecard. Every closed period we record our fair value shortly before the open, then
 * score it against the official opening print. The benchmark is the naive forecast: last close.
 * If we can't beat "the price didn't move", the product has no business sending alerts.
 */
export interface Forecast {
  ticker: string;
  periodStart: number;   // last close (ms)
  openAt: number;        // the open being forecast (ms)
  lastClose: number;
  fairValue: number;     // our forecast, captured before the open
  tokenOnly?: number;    // the token-consensus-only forecast, for comparison
  actualOpen?: number;   // filled in after the open
}

export interface Score {
  n: number;
  maeBps: number;          // our mean absolute error, basis points of the open
  naiveMaeBps: number;     // last-close forecast error
  tokenOnlyMaeBps?: number;
  improvementPct: number;  // how much less error than naive (positive = better)
  directionHitRate: number;// share of gaps >= minGapBps whose sign we called
}

const bps = (f: number, a: number) => Math.abs(f / a - 1) * 10_000;

export function score(forecasts: Forecast[], minGapBps = 50): Score {
  const done = forecasts.filter((f) => f.actualOpen && f.actualOpen > 0);
  const n = done.length;
  if (!n) return { n: 0, maeBps: 0, naiveMaeBps: 0, improvementPct: 0, directionHitRate: 0 };
  const mae = done.reduce((s, f) => s + bps(f.fairValue, f.actualOpen!), 0) / n;
  const naive = done.reduce((s, f) => s + bps(f.lastClose, f.actualOpen!), 0) / n;
  const tok = done.filter((f) => f.tokenOnly);
  const tokMae = tok.length ? tok.reduce((s, f) => s + bps(f.tokenOnly!, f.actualOpen!), 0) / tok.length : undefined;
  const gaps = done.filter((f) => bps(f.lastClose, f.actualOpen!) >= minGapBps);
  const hits = gaps.filter((f) => Math.sign(f.fairValue - f.lastClose) === Math.sign(f.actualOpen! - f.lastClose)).length;
  return {
    n, maeBps: mae, naiveMaeBps: naive, tokenOnlyMaeBps: tokMae,
    improvementPct: naive ? (1 - mae / naive) * 100 : 0,
    directionHitRate: gaps.length ? hits / gaps.length : 0,
  };
}

/**
 * Pick the external-signal weight that would have minimised error on past periods.
 * Rows carry the two raw inputs so the blend can be recomputed for any weight.
 */
export function calibrateExternalWeight(rows: { lastClose: number; external: number; tokens: number; actualOpen: number }[], step = 0.05): { weight: number; maeBps: number } {
  let best = { weight: 0.7, maeBps: Infinity };
  for (let w = 0; w <= 1.0001; w += step) {
    const mae = rows.reduce((s, r) => {
      const lc = Math.log(r.lastClose);
      const f = Math.exp(lc + w * (Math.log(r.external) - lc) + (1 - w) * (Math.log(r.tokens) - lc));
      return s + bps(f, r.actualOpen);
    }, 0) / Math.max(1, rows.length);
    if (mae < best.maeBps) best = { weight: Math.round(w * 100) / 100, maeBps: mae };
  }
  return best;
}
