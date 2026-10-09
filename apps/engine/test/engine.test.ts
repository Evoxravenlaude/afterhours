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

/** A Friday-session reading where every token sits at the stock's price, so each learns a basis of 1. */
function friday(now: number): Snapshot {
  const s = snap(now, 200, 200);
  s.tickers.get("NVDA")!.quotes = s.tickers.get("NVDA")!.quotes.map((q) => ({ ...q, tokenPrice: 200 }));
  return s;
}

describe("engine", () => {
  it("captures the close while open, alerts while closed, dedupes, then settles at the open", async () => {
    const store = new Store(":memory:");
    const notify = { alert: vi.fn(async () => {}), morning: vi.fn(async () => {}) };
    const e = new Engine(store, { ...config, forecastLeadMin: 5, openReadDelayMin: 2 }, notify);

    for (let i = 0; i < 10; i++) await e.tick(friday(T("2026-10-09T19:45:00Z") + i * 60_000)); // Friday, open: spot + basis
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
    expect(a.worthPct!).toBeCloseTo(205.6 / 199 - 1, 6);   // paper: vs the official open
    expect(a.tradedPct!).toBeCloseTo(205 / 199 - 1, 6);    // real: the xStocks token itself after the open
    expect(notify.morning).toHaveBeenCalledTimes(1);
    expect(e.scorecard().improvementPct).toBeGreaterThan(50);
  });

  it("silences alerts around a scheduled multiplier change", async () => {
    const store = new Store(":memory:");
    const e = new Engine(store, config);
    for (let i = 0; i < 10; i++) await e.tick(friday(T("2026-10-09T19:45:00Z") + i * 60_000));
    const s = snap(T("2026-10-10T12:00:00Z"), 199);
    s.tickers.get("NVDA")!.guards.push({ ticker: "NVDA", pendingMultiplier: { multiplier: 1.004, effectiveAt: T("2026-10-10T20:00:00Z"), issuer: "xstocks" } });
    const r = await e.tick(s);
    expect(r.alerts).toHaveLength(0);
    expect(r.suppressed).toBe(1);
  });
});

describe("unlearned tokens", () => {
  it("stays quiet on a token whose basis hasn't been learned yet", async () => {
    const store = new Store(":memory:");
    const e = new Engine(store, config);
    await e.tick(snap(T("2026-10-09T19:55:00Z"), 200, 200));          // one open-market reading: not enough to learn
    const r = await e.tick(snap(T("2026-10-10T12:00:00Z"), 199));
    expect(r.alerts).toHaveLength(0);
    expect(r.suppressed).toBeGreaterThan(0);
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
    const d = { periodLabel: "Fri close → Mon open", alerts: [{ ...row, worthPct: 0.04, tradedPct: 0.033, taken: 1 }], score: { n: 4, maeBps: 22, naiveMaeBps: 140, improvementPct: 84, directionHitRate: 1 } };
    expect(cardSvg(d)).toContain("+3.3%");
    const png = cardPng(d);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("live basis learning", () => {
  it("learns a token's steady discount while open and stops it from alerting while closed", async () => {
    const store = new Store(":memory:");
    const e = new Engine(store, config);
    // xStocks normally sits 1.6% under the stock. Learn that across a Friday session.
    for (let i = 0; i < 10; i++) await e.tick(snap(T("2026-10-09T18:00:00Z") + i * 60_000, 200 * 0.984, 200));
    expect(Number(store.get("basis:0x0000000000000000000000000000000000000003"))).toBeCloseTo(0.984, 3);
    // Saturday: xStocks still 1.6% under, everyone else at 205. Without basis this would alert.
    const r = await e.tick(snap(T("2026-10-10T12:00:00Z"), 205 * 0.984));
    expect(r.alerts).toHaveLength(0);
  });
});

import { healthText } from "../src/telegram.js";
describe("episodes and health", () => {
  it("doesn't re-alert when a token hovers at the threshold without returning to the band", async () => {
    const store = new Store(":memory:");
    const e = new Engine(store, config);
    for (let i = 0; i < 10; i++) await e.tick(friday(T("2026-10-09T19:45:00Z") + i * 60_000));
    const first = await e.tick(snap(T("2026-10-10T12:00:00Z"), 199));
    expect(first.alerts).toHaveLength(1);
    await e.tick(snap(T("2026-10-10T12:05:00Z"), 204));   // still outside the band, below the alert threshold
    const again = await e.tick(snap(T("2026-10-10T12:10:00Z"), 199));
    expect(again.alerts).toHaveLength(0);
  });
  it("starts a new episode after 30 minutes back inside the band", async () => {
    const store = new Store(":memory:");
    const e = new Engine(store, config);
    for (let i = 0; i < 10; i++) await e.tick(friday(T("2026-10-09T19:45:00Z") + i * 60_000));
    await e.tick(snap(T("2026-10-10T12:00:00Z"), 199));
    await e.tick(snap(T("2026-10-10T12:05:00Z"), 205.1));
    await e.tick(snap(T("2026-10-10T12:40:00Z"), 205.1));
    const again = await e.tick(snap(T("2026-10-10T12:45:00Z"), 199));
    expect(again.alerts).toHaveLength(1);
  });
  it("answers /health in plain words", async () => {
    const store = new Store(":memory:");
    store.set("lasttick", JSON.stringify({ at: T("2026-10-10T12:00:00Z"), fv: 63, alerts: 0, silenced: 2 }));
    const text = healthText(store, T("2026-10-10T12:01:00Z"));
    expect(text).toMatch(/Running\. Last update 60s ago\./);
    expect(text).toMatch(/Market closed\. Opens in/);
    expect(text).toMatch(/Pricing 63 stocks/);
  });
});
