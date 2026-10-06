import { describe, it, expect } from "vitest";
import { backtestPeriod, alertOutcomes, score } from "../src/index.js";

const H = 3_600_000;
const close = Date.parse("2026-10-02T20:00:00Z");
const open = Date.parse("2026-10-05T13:30:00Z");
// Friday close $200. Over the weekend the perp drifts to $206; one issuer lags at $199; the open prints $205.5.
const series = (from: number, to: number, start: number, end: number) => {
  const out = []; const n = Math.round((to - from) / (15 * 60_000));
  for (let i = 0; i <= n; i++) out.push({ t: from + i * 15 * 60_000, c: start + (end - start) * (i / n), v: 50_000 });
  return out;
};

const input = {
  ticker: "NVDA", lastClose: 200, lastCloseAt: close, openAt: open, actualOpen: 205.5,
  external: series(close, open, 200, 206),
  tokens: [
    { issuer: "bstocks" as const, symbol: "bNVDA", contract: "0x0000000000000000000000000000000000000001" as const, multiplier: 1, candles: series(close, open, 200, 205.6) },
    { issuer: "ondo" as const, symbol: "NVDAon", contract: "0x0000000000000000000000000000000000000002" as const, multiplier: 1.002, candles: series(close, open, 200.4, 206.0) },
    { issuer: "xstocks" as const, symbol: "NVDAx", contract: "0x0000000000000000000000000000000000000003" as const, multiplier: 1, candles: series(close, open, 200, 199) },
  ],
};

describe("backtest", () => {
  it("forecasts the open better than last close and better than tokens alone when a token lags", () => {
    const r = backtestPeriod(input);
    const s = score([r.forecast]);
    expect(r.forecast.fairValue).toBeGreaterThan(204);
    expect(s.maeBps).toBeLessThan(s.naiveMaeBps);
    expect(s.directionHitRate).toBe(1);
  });
  it("finds the lagging issuer and values the alerts at the open", () => {
    const r = backtestPeriod(input);
    expect(r.alerts.length).toBeGreaterThan(0);
    expect(r.alerts.every((a) => a.issuer === "xstocks" && a.side === "buy")).toBe(true);
    const o = alertOutcomes(r.alerts);
    expect(o.winRate).toBe(1);
    expect(o.avgNetPct).toBeGreaterThan(0);
  });
  it("deduplicates repeated alerts on the same token and side", () => {
    const r = backtestPeriod(input);
    const keys = r.alerts.map((a) => a.contract + a.side);
    // Re-alerts only happen when the edge grows by half, so far fewer alerts than 15-minute steps.
    expect(r.alerts.length).toBeLessThan(((open - close) / (15 * 60_000)) / 4);
    expect(new Set(keys).size).toBe(1);
  });
});
