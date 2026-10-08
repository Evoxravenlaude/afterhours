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

/** Codes that mean the token itself can't be traded normally. Closed-market codes are not pauses: closed hours are the point. */
const PAUSE_CODES = new Set(["market_paused", "asset_paused", "asset_limited", "unsupported", "market_maintenance", "maintenance"]);
const OPEN_CODES = new Set(["", "trading", "market_closed"]);

/**
 * The live API returns openState as the strings "true"/"false" with the reason in reasonCode
 * (e.g. {"openState":"true","marketStatus":"overnight","reasonCode":"TRADING"}); the skill docs list
 * the reasons as states. Accept both shapes.
 */
export function isPaused(openState: string, reasonCode: string): boolean {
  if (PAUSE_CODES.has(reasonCode) || PAUSE_CODES.has(openState.toLowerCase())) return true;
  if (openState === "false" && !OPEN_CODES.has(reasonCode)) return true;
  return false;
}

/**
 * Issuer trading windows. Ondo Global Markets runs 24/5: Binance's k-lines for Ondo tokens stop at
 * Friday 20:00 ET and resume Sunday 20:00 ET (two weekends seen, 2026-09-25 and 2026-10-02). A frozen
 * Friday-evening price is not a weekend dislocation and can't be traded, so it never alerts.
 */
export function issuerClosed(issuer: string, now: number): boolean {
  if (issuer !== "ondo") return false;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(now));
  const wd = parts.find((p) => p.type === "weekday")!.value, h = Number(parts.find((p) => p.type === "hour")!.value);
  return (wd === "Fri" && h >= 20) || wd === "Sat" || (wd === "Sun" && h < 20);
}

export type Suppression = { ticker: string; reason: string };

/**
 * Why a dislocation should not be alerted. A token about to rebase (dividend reinvestment or split) will
 * look mispriced against fair value until the multiplier updates; alerting then sends people into a trap.
 */
export function suppressionFor(d: Dislocation, states: GuardState[], now: number, cfg: GuardConfig = DEFAULT_GUARD): string | null {
  if (issuerClosed(d.issuer, now)) return `${d.issuer} not trading (24/5: Friday 8pm to Sunday 8pm ET)`;
  for (const s of states) {
    if (s.ticker !== d.ticker) continue;
    const pm = s.pendingMultiplier;
    if (pm && now >= pm.effectiveAt - cfg.preWindowMs && now <= pm.effectiveAt + cfg.postWindowMs) {
      return `multiplier change scheduled for ${pm.issuer} at ${new Date(pm.effectiveAt).toISOString()}`;
    }
    const st = s.assetStatus;
    if (st) {
      const code = (st.reasonCode ?? "").toLowerCase();
      if (CORPORATE_ACTION_CODES.has(code)) return `${st.issuer} paused for ${code}`;
      if (st.issuer === d.issuer && isPaused(st.openState, code)) return `${st.issuer} status ${st.reasonCode ?? st.openState}`;
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
