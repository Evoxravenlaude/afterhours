import type { Dislocation, GuardState } from "./types.js";

/** Reason codes from Binance's asset market status API that mean prices are mid-adjustment. */
export const CORPORATE_ACTION_CODES = new Set([
  "cash_dividend", "stock_dividend", "stock_split", "merger", "acquisition", "spinoff", "corporate action", "earnings",
]);

export interface GuardConfig {
  /** Silence a ticker from this long before a scheduled multiplier change ... */
  preWindowMs: number;
  /** ... until this long after it takes effect. */
  postWindowMs: number;
}

export const DEFAULT_GUARD: GuardConfig = { preWindowMs: 24 * 3_600_000, postWindowMs: 6 * 3_600_000 };

export type Suppression = { ticker: string; reason: string };

/**
 * Why a dislocation should not be alerted. A token about to rebase (dividend reinvestment or split) will
 * look mispriced against fair value until the multiplier updates; alerting then sends people into a trap.
 */
export function suppressionFor(d: Dislocation, states: GuardState[], now: number, cfg: GuardConfig = DEFAULT_GUARD): string | null {
  for (const s of states) {
    if (s.ticker !== d.ticker) continue;
    const pm = s.pendingMultiplier;
    if (pm && now >= pm.effectiveAt - cfg.preWindowMs && now <= pm.effectiveAt + cfg.postWindowMs) {
      return `multiplier change scheduled for ${pm.issuer} at ${new Date(pm.effectiveAt).toISOString()}`;
    }
    const st = s.assetStatus;
    if (st && st.openState !== "TRADING" && st.openState !== "MARKET_CLOSED") {
      const code = (st.reasonCode ?? "").toLowerCase();
      if (CORPORATE_ACTION_CODES.has(code)) return `${st.issuer} paused for ${code}`;
      if (st.issuer === d.issuer) return `${st.issuer} status ${st.openState}`;
    }
  }
  return null;
}

export function applyGuards(ds: Dislocation[], states: GuardState[], now: number, cfg: GuardConfig = DEFAULT_GUARD) {
  const alerts: Dislocation[] = []; const suppressed: (Dislocation & { reason: string })[] = [];
  for (const d of ds) {
    const r = suppressionFor(d, states, now, cfg);
    if (r) suppressed.push({ ...d, reason: r }); else alerts.push(d);
  }
  return { alerts, suppressed };
}

export interface RealertRule { growthFactor: number; growthMinGapMs: number }
/**
 * One alert per episode. An episode starts when a token leaves the band and ends when it comes back inside.
 * Within an episode we only speak again if the edge has doubled and at least two hours have passed.
 */
export const DEFAULT_REALERT: RealertRule = { growthFactor: 2, growthMinGapMs: 2 * 3_600_000 };

export function shouldRealert(
  prev: { at: number; netEdgePct: number } | undefined,
  next: { at: number; netEdgePct: number },
  lastInBandAt = 0,
  rule: RealertRule = DEFAULT_REALERT,
): boolean {
  if (!prev) return true;
  if (lastInBandAt > prev.at) return true; // it came back inside the band since we last alerted: new episode
  return next.at - prev.at >= rule.growthMinGapMs && next.netEdgePct >= prev.netEdgePct * rule.growthFactor;
}
