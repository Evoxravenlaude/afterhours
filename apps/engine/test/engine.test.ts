import { describe, it, expect, vi } from "vitest";
import { Store } from "../src/store.js";
import { Engine } from "../src/engine.js";
import { config } from "../src/config.js";
import { alertText, quoteCommand, BSC_USDT } from "../src/telegram.js";
import { cardSvg, cardPng } from "../src/card.js";
import type { Snapshot } from "../src/collector.js";

const T = (iso: string) => Date.parse(iso);
const tok = (issuer: "bstocks" | "ondo" | "xstocks", price: number, n: string) => ({ issuer, symbol: `${issuer}NVDA`, ticker: "NVDA", contract: `0x000000000000000000000000000000000000000${n}` as `0x${string}`, tokenPrice: price, multiplier: 1, liquidityUsd: 100_000, observedAt: 0 });

function snap(now: number, xPrice: number, oracle?: number): Snapshot {
  return { now, tickers: new Map([["NVDA", {
    quotes: [tok("bstocks", 205, "1"), tok("ondo", 205.2, "2"), tok("xstocks", xPrice, "3")].map((q) => ({ ...q, observedAt: now })),
    external: { source: "hyperliquid", ticker: "NVDA", price: 205.1, observedAt: now },
    guards: [], oraclePx: oracle,
  }]]) };
}

describe("engine", () => {
  it("captures the close while open, alerts while closed, dedupes, then settles at the open", async () => {
    const store = new Store(":memory:");
    const notify = { alert: vi.fn(async () => {}), morning: vi.fn(async () => {}) };
    const e = new Engine(store, { ...config, forecastLeadMin: 5, openReadDelayMin: 2 }, notify);

    await e.tick(snap(T("2026-10-09T19:55:00Z"), 200, 200));        // Friday, open: records spot
    const sat = await e.tick(snap(T("2026-10-10T12:00:00Z"), 199)); // Saturday: xStocks lags
    expect(sat.alerts).toHaveLength(1);
    expect(sat.alerts[0].issuer).toBe("xstocks");
    expect(notify.alert).toHaveBeenCalledTimes(1);

    const again = await e.tick(snap(T("2026-10-10T12:05:00Z"), 199)); // same edge 5 min later: no repeat
    expect(again.alerts).toHaveLength(0);

    await e.tick(snap(T("2026-10-12T13:27:00Z"), 199));              // Monday pre-open: forecast locked
    expect(store.forecasts()[0].fairValue).toBeGreaterThan(204);

    const mon = await e.tick(snap(T("2026-10-12T13:33:00Z"), 205, 205.6)); // open + 3 min: settle
    expect(mon.settled).toContain("NVDA");
    const f = store.forecasts()[0];
    expect(f.actualOpen).toBe(205.6);
    const a = store.recentAlerts()[0];
    expect(a.worthPct!).toBeCloseTo(205.6 / 199 - 1, 6);
    expect(notify.morning).toHaveBeenCalledTimes(1);
    expect(e.scorecard().improvementPct).toBeGreaterThan(50);
  });

  it("silences alerts around a scheduled multiplier change", async () => {
    const store = new Store(":memory:");
    const e = new Engine(store, config);
    await e.tick(snap(T("2026-10-09T19:55:00Z"), 200, 200));
    const s = snap(T("2026-10-10T12:00:00Z"), 199);
    s.tickers.get("NVDA")!.guards.push({ ticker: "NVDA", pendingMultiplier: { multiplier: 1.004, effectiveAt: T("2026-10-10T20:00:00Z"), issuer: "xstocks" } });
    const r = await e.tick(s);
    expect(r.alerts).toHaveLength(0);
    expect(r.suppressed).toBe(1);
  });
});

describe("delivery", () => {
  const row = { id: 1, ticker: "NVDA", issuer: "xstocks" as const, symbol: "NVDAx", contract: "0x0000000000000000000000000000000000000003" as const, side: "buy" as const,
    sharePrice: 199, fairValue: 205, edgePct: -0.0293, netEdgePct: 0.0238, at: 0, periodStart: 0 };
  it("writes a readable alert", () => {
    const text = alertText(row, { ticker: "NVDA", at: 0, lastClose: 200, lastCloseAt: 0, value: 205, low: 204, high: 206,
      inputs: { tokenConsensus: 205.1, external: 205.1, weights: { external: 0.7, tokens: 0.3 }, sigma: 0.002, hoursClosed: 16 } });
    expect(text).toMatch(/NVDA on xStocks is 2.9% under fair value/);
    expect(text).toContain(row.contract);
  });
  it("produces the documented Agentic Wallet quote syntax", () => {
    const cmd = quoteCommand(row, 100);
    expect(cmd).toBe(`baw market-order quote --fromTokenQty 100 --fromToken ${BSC_USDT} --toToken ${row.contract} --binanceChainId 56 --json`);
    expect(quoteCommand({ ...row, side: "sell" }, 199)).toContain(`--fromToken ${row.contract} --toToken ${BSC_USDT}`);
  });
  it("renders the morning card", () => {
    const d = { periodLabel: "Fri close → Mon open", alerts: [{ ...row, worthPct: 0.033, taken: 1 }], score: { n: 4, maeBps: 22, naiveMaeBps: 140, improvementPct: 84, directionHitRate: 1 } };
    expect(cardSvg(d)).toContain("+3.3%");
    const png = cardPng(d);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});
