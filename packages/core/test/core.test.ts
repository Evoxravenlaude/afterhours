import { describe, it, expect } from "vitest";
import {
  isOpen, lastClose, nextOpen, hoursClosed, sessionFor, isTradingDay,
  DEFAULT_MODEL, sharePrice, tokenConsensus, fairValue, findDislocations, applyGuards, score, calibrateExternalWeight,
  type TokenQuote,
} from "../src/index.js";

const T = (iso: string) => Date.parse(iso);

describe("calendar", () => {
  it("regular session in EDT is 13:30–20:00 UTC", () => {
    const s = sessionFor("2026-10-06")!;
    expect(new Date(s.open).toISOString()).toBe("2026-10-06T13:30:00.000Z");
    expect(new Date(s.close).toISOString()).toBe("2026-10-06T20:00:00.000Z");
  });
  it("regular session in EST is 14:30–21:00 UTC", () => {
    const s = sessionFor("2026-12-07")!;
    expect(new Date(s.open).toISOString()).toBe("2026-12-07T14:30:00.000Z");
  });
  it("early close on the day after Thanksgiving", () => {
    expect(new Date(sessionFor("2026-11-27")!.close).toISOString()).toBe("2026-11-27T18:00:00.000Z");
  });
  it("weekends and holidays are closed", () => {
    expect(isTradingDay("2026-10-10")).toBe(false);
    expect(isTradingDay("2026-11-26")).toBe(false);
    expect(isTradingDay("2026-10-12")).toBe(true); // Columbus Day: NYSE open
  });
  it("open/closed and the weekend gap", () => {
    expect(isOpen(T("2026-10-06T15:00:00Z"))).toBe(true);
    expect(isOpen(T("2026-10-10T15:00:00Z"))).toBe(false);
    const sat = T("2026-10-10T12:00:00Z");
    expect(new Date(lastClose(sat)).toISOString()).toBe("2026-10-09T20:00:00.000Z");
    expect(new Date(nextOpen(sat)).toISOString()).toBe("2026-10-12T13:30:00.000Z");
    expect(hoursClosed(sat)).toBeCloseTo(16, 5);
  });
  it("skips a holiday when finding the next open", () => {
    expect(new Date(nextOpen(T("2026-11-25T22:00:00Z"))).toISOString()).toBe("2026-11-27T14:30:00.000Z");
  });
});

const q = (issuer: TokenQuote["issuer"], tokenPrice: number, multiplier = 1, liquidityUsd = 100_000, observedAt = T("2026-10-10T12:00:00Z")): TokenQuote =>
  ({ issuer, symbol: `${issuer}-NVDA`, ticker: "NVDA", contract: "0x0000000000000000000000000000000000000001", tokenPrice, multiplier, liquidityUsd, observedAt });

describe("model", () => {
  it("share price divides by the multiplier", () => {
    expect(sharePrice({ tokenPrice: 202, multiplier: 1.01 })).toBeCloseTo(200, 6);
  });
  it("consensus drops a broken quote", () => {
    const c = tokenConsensus([q("bstocks", 200), q("ondo", 201), q("xstocks", 300)])!;
    expect(c.used).toHaveLength(2);
    expect(c.value).toBeGreaterThanOrEqual(200);
    expect(c.value).toBeLessThanOrEqual(201);
  });
  it("blends the external signal and tokens in log space", () => {
    const now = T("2026-10-10T12:00:00Z");
    const fv = fairValue({
      ticker: "NVDA", now, lastClose: 200, lastCloseAt: T("2026-10-09T20:00:00Z"), hoursClosed: 16,
      quotes: [q("bstocks", 204), q("ondo", 204)],
      external: { source: "hyperliquid", ticker: "NVDA", price: 210, observedAt: now },
    }, { ...DEFAULT_MODEL, externalWeight: 0.7 });
    const expected = Math.exp(Math.log(200) + 0.7 * Math.log(210 / 200) + 0.3 * Math.log(204 / 200));
    expect(fv.value).toBeCloseTo(expected, 6);
    expect(fv.low).toBeLessThan(fv.value);
    expect(fv.high).toBeGreaterThan(fv.value);
  });
  it("ignores a stale external signal", () => {
    const now = T("2026-10-10T12:00:00Z");
    const fv = fairValue({
      ticker: "NVDA", now, lastClose: 200, lastCloseAt: 0, hoursClosed: 16,
      quotes: [q("bstocks", 204)],
      external: { source: "hyperliquid", ticker: "NVDA", price: 250, observedAt: now - 3_600_000 },
    });
    expect(fv.value).toBeCloseTo(204, 6);
    expect(fv.inputs.weights.external).toBe(0);
  });
  it("falls back to last close with a widening band", () => {
    const fv8 = fairValue({ ticker: "NVDA", now: 0, lastClose: 200, lastCloseAt: 0, hoursClosed: 8, quotes: [] });
    const fv60 = fairValue({ ticker: "NVDA", now: 0, lastClose: 200, lastCloseAt: 0, hoursClosed: 60, quotes: [] });
    expect(fv8.value).toBe(200);
    expect(fv60.high - fv60.low).toBeGreaterThan(fv8.high - fv8.low);
  });
  it("flags only tokens outside the band by more than costs", () => {
    const now = T("2026-10-10T12:00:00Z");
    const quotes = [q("bstocks", 200), q("ondo", 200.2), q("xstocks", 196)];
    const fv = fairValue({
      ticker: "NVDA", now, lastClose: 200, lastCloseAt: 0, hoursClosed: 16, quotes,
      external: { source: "hyperliquid", ticker: "NVDA", price: 200.1, observedAt: now },
    });
    const ds = findDislocations(fv, quotes);
    expect(ds).toHaveLength(1);
    expect(ds[0].issuer).toBe("xstocks");
    expect(ds[0].side).toBe("buy");
    expect(ds[0].netEdgePct).toBeGreaterThan(0);
  });
  it("respects multipliers: a token that rebased is not cheap", () => {
    const now = T("2026-10-10T12:00:00Z");
    // bStocks token reinvested a dividend: 1 raw token = 1.005 shares, so it trades 0.5% higher per token.
    const quotes = [q("bstocks", 201, 1.005), q("ondo", 200)];
    const fv = fairValue({ ticker: "NVDA", now, lastClose: 200, lastCloseAt: 0, hoursClosed: 16, quotes,
      external: { source: "hyperliquid", ticker: "NVDA", price: 200, observedAt: now } });
    expect(findDislocations(fv, quotes)).toHaveLength(0);
  });
});

describe("guards", () => {
  const d = { ticker: "NVDA", issuer: "xstocks" as const, symbol: "x", contract: "0x0000000000000000000000000000000000000001" as const,
    sharePrice: 196, fairValue: 200, edgePct: -0.02, netEdgePct: 0.0145, side: "buy" as const, at: 0 };
  it("silences a ticker around a scheduled multiplier change", () => {
    const now = T("2026-10-10T12:00:00Z");
    const r = applyGuards([d], [{ ticker: "NVDA", pendingMultiplier: { multiplier: 1.004, effectiveAt: now + 3_600_000, issuer: "bstocks" } }], now);
    expect(r.alerts).toHaveLength(0);
    expect(r.suppressed[0].reason).toMatch(/multiplier change/);
  });
  it("silences on a corporate-action pause", () => {
    const r = applyGuards([d], [{ ticker: "NVDA", assetStatus: { issuer: "ondo", openState: "ASSET_PAUSED", reasonCode: "stock_split" } }], 0);
    expect(r.suppressed[0].reason).toMatch(/stock_split/);
  });
  it("lets a normal weekend dislocation through", () => {
    const r = applyGuards([d], [{ ticker: "NVDA", assetStatus: { issuer: "xstocks", openState: "MARKET_CLOSED" } }], 0);
    expect(r.alerts).toHaveLength(1);
  });
});

describe("scorecard", () => {
  it("measures improvement over the last-close forecast", () => {
    const s = score([
      { ticker: "NVDA", periodStart: 0, openAt: 1, lastClose: 200, fairValue: 205, actualOpen: 206 },
      { ticker: "TSLA", periodStart: 0, openAt: 1, lastClose: 300, fairValue: 294, actualOpen: 293 },
    ]);
    expect(s.n).toBe(2);
    expect(s.maeBps).toBeLessThan(s.naiveMaeBps);
    expect(s.improvementPct).toBeGreaterThan(50);
    expect(s.directionHitRate).toBe(1);
  });
  it("calibrates toward the signal that predicted opens", () => {
    const rows = [
      { lastClose: 100, external: 103, tokens: 101, actualOpen: 103 },
      { lastClose: 100, external: 97, tokens: 99, actualOpen: 97.2 },
    ];
    expect(calibrateExternalWeight(rows).weight).toBeGreaterThanOrEqual(0.9);
  });
});

import { shouldRealert } from "../src/index.js";
describe("re-alert rule", () => {
  const H = 3_600_000;
  it("stays quiet while an edge creeps up within one episode", () => {
    expect(shouldRealert({ at: 0, netEdgePct: 0.01 }, { at: 1 * H, netEdgePct: 0.018 })).toBe(false);
    expect(shouldRealert({ at: 0, netEdgePct: 0.01 }, { at: 20 * H, netEdgePct: 0.012 })).toBe(false);
  });
  it("speaks again when the edge doubles after two hours", () => {
    expect(shouldRealert({ at: 0, netEdgePct: 0.01 }, { at: 2 * H, netEdgePct: 0.02 })).toBe(true);
  });
  it("starts a new episode after the token returned inside the band", () => {
    expect(shouldRealert({ at: 0, netEdgePct: 0.01 }, { at: 3 * H, netEdgePct: 0.01 }, 2 * H)).toBe(true);
  });
});

import { estimateBasis, isPaused } from "../src/index.js";
describe("issuer basis", () => {
  it("learns a steady discount and corrects closed-hours share prices", () => {
    const pairs = Array.from({ length: 12 }, (_, i) => ({ tokenShare: 98.4 + (i % 3) * 0.02, truth: 100 }));
    const b = estimateBasis(pairs)!;
    expect(b).toBeCloseTo(0.9842, 3);
    // A token that normally trades 1.6% under the stock is not "cheap" when it sits 1.6% under.
    expect(sharePrice({ tokenPrice: 98.42, multiplier: 1, basis: b })).toBeCloseTo(100, 1);
  });
  it("refuses too few points or an absurd ratio", () => {
    expect(estimateBasis([{ tokenShare: 99, truth: 100 }])).toBeUndefined();
    expect(estimateBasis(Array.from({ length: 10 }, () => ({ tokenShare: 150, truth: 100 })))).toBeUndefined();
  });
});

describe("status shapes from the live API", () => {
  it("treats the documented live shape as trading, including overnight", () => {
    expect(isPaused("true", "trading")).toBe(false);
    expect(isPaused("false", "market_closed")).toBe(false);
  });
  it("treats pauses as pauses in either shape", () => {
    expect(isPaused("false", "asset_paused")).toBe(true);
    expect(isPaused("ASSET_LIMITED", "")).toBe(true);
    expect(isPaused("false", "something_new")).toBe(true);
  });
  it("lets a weekend alert through when the token reports market closed", () => {
    const d = { ticker: "NVDA", issuer: "xstocks" as const, symbol: "x", contract: "0x0000000000000000000000000000000000000001" as const, sharePrice: 196, fairValue: 200, edgePct: -0.02, netEdgePct: 0.0145, side: "buy" as const, at: 0 };
    expect(applyGuards([d], [{ ticker: "NVDA", assetStatus: { issuer: "xstocks", openState: "false", reasonCode: "MARKET_CLOSED" } }], 0).alerts).toHaveLength(1);
    expect(applyGuards([d], [{ ticker: "NVDA", assetStatus: { issuer: "ondo", openState: "false", reasonCode: "cash_dividend" } }], 0).alerts).toHaveLength(0);
  });
});

import { issuerClosed, suppressionFor } from "../src/index.js";
describe("issuer hours", () => {
  it("Ondo trades 24/5: closed Friday 8pm to Sunday 8pm ET", () => {
    expect(issuerClosed("ondo", T("2026-10-02T23:30:00Z"))).toBe(false); // Fri 7:30pm EDT
    expect(issuerClosed("ondo", T("2026-10-03T00:30:00Z"))).toBe(true);  // Fri 8:30pm EDT
    expect(issuerClosed("ondo", T("2026-10-03T15:00:00Z"))).toBe(true);  // Saturday
    expect(issuerClosed("ondo", T("2026-10-04T23:30:00Z"))).toBe(true);  // Sun 7:30pm EDT
    expect(issuerClosed("ondo", T("2026-10-05T00:30:00Z"))).toBe(false); // Sun 8:30pm EDT
    expect(issuerClosed("bstocks", T("2026-10-03T15:00:00Z"))).toBe(false);
  });
  it("silences a frozen Ondo price on Saturday", () => {
    const d = { ticker: "NVDA", issuer: "ondo" as const, symbol: "NVDAon", contract: "0x0000000000000000000000000000000000000001" as const,
      sharePrice: 196, fairValue: 200, edgePct: -0.02, netEdgePct: 0.0145, side: "buy" as const, at: 0 };
    expect(suppressionFor(d, [], T("2026-10-03T15:00:00Z"))).toMatch(/24\/5/);
  });
});
