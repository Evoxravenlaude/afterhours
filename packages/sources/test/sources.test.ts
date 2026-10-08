import { describe, it, expect } from "vitest";
import { BinanceRwa, HyperliquidStocks, inferIssuer, fromE18 } from "../src/index.js";

/** A fetch that replays canned bodies keyed by URL substring. Shapes follow the documented fields. */
function replay(map: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input) + (init?.body ? String(init.body) : "");
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(map[key]), { status: 200 });
  }) as typeof fetch;
}

const ok = (data: unknown) => ({ code: "000000", message: null, data, success: true });

describe("issuer inference", () => {
  it("reads symbol conventions", () => {
    expect(inferIssuer("NVDAon")).toBe("ondo");
    expect(inferIssuer("bNVDA")).toBe("bstocks");
    expect(inferIssuer("TSLAx")).toBe("xstocks");
    expect(inferIssuer("WEIRD")).toBe("unknown");
    expect(inferIssuer("anything", 1)).toBe("ondo");
  });
});

describe("Binance RWA client", () => {
  const fetchImpl = replay({
    "rwa/stock/detail/list/ai": ok([
      { chainId: "56", contractAddress: "0xAbC0000000000000000000000000000000000001", symbol: "NVDAon", ticker: "nvda", type: 1, multiplier: "1.0021" },
      { chainId: "56", contractAddress: "0xabc0000000000000000000000000000000000002", symbol: "bNVDA", ticker: "NVDA", type: 2, multiplier: "1" },
      { chainId: "56", contractAddress: null, symbol: "broken" },
    ]),
    "rwa/dynamic/ai": ok({ symbol: "NVDAon", ticker: "NVDA", tokenInfo: { price: "190.42", sharesMultiplier: "1.0021", volume24h: "523000", totalHolders: 812 }, stockInfo: { price: "190.01", lastCashAmount: "0.01", dividendYield: "0.02" } }),
    "rwa/asset/market/status/ai": ok({ openState: "ASSET_PAUSED", marketStatus: "CLOSED", reasonCode: "cash_dividend", reasonMsg: "Dividend processing" }),
    "dex/market/token/kline/ai": ok({ klineInfos: [[1, "189", "191", "188", "190.5", "0", 2], [3, "190.5", "192", "190", "191.2", "0", 4]], decimals: 18 }),
  });
  const b = new BinanceRwa({ fetchImpl, retries: 0 });

  it("lists tokens, lowercases addresses, drops rows without a contract", async () => {
    const list = await b.listTokens();
    expect(list).toHaveLength(2);
    expect(list[0].contract).toBe("0xabc0000000000000000000000000000000000001");
    expect(list[0].ticker).toBe("NVDA");
    expect(list[0].multiplier).toBeCloseTo(1.0021);
  });
  it("parses dynamic info with string numbers", async () => {
    const d = await b.dynamic("0xabc");
    expect(d.tokenPrice).toBeCloseTo(190.42);
    expect(d.sharesMultiplier).toBeCloseTo(1.0021);
    expect(d.lastCashAmount).toBeCloseTo(0.01);
  });
  it("surfaces corporate-action reason codes", async () => {
    const s = await b.assetStatus("0xabc");
    expect(s.openState).toBe("ASSET_PAUSED");
    expect(s.reasonCode).toBe("cash_dividend");
  });
  it("parses k-lines", async () => {
    const k = await b.klines("0xabc");
    expect(k.map((x) => x.close)).toEqual([190.5, 191.2]);
  });
  it("builds a model-ready quote, preferring the on-chain multiplier", async () => {
    const [t] = await b.listTokens();
    const q = (await b.quote(t, 1.003))!;
    expect(q.multiplier).toBe(1.003);
    expect(q.tokenPrice).toBeCloseTo(190.42);
    expect(q.issuer).toBe("ondo");
  });
  it("throws on a Binance error envelope", async () => {
    const bad = new BinanceRwa({ fetchImpl: replay({ "rwa/market/status/ai": { code: "100001", message: "bad", success: false } }), retries: 0 });
    await expect(bad.marketStatus()).rejects.toThrow(/code=100001/);
  });
});

describe("Hyperliquid stock perps", () => {
  const fetchImpl = replay({
    '"dex":"xyz"': [
      { universe: [{ name: "xyz:NVDA" }, { name: "xyz:TSLA" }, { name: "xyz:THIN" }] },
      [{ midPx: "191.10", markPx: "191.05", dayNtlVlm: "45880000" }, { midPx: null, markPx: "440.2", dayNtlVlm: "9000000" }, { midPx: "10", dayNtlVlm: "1000" }],
    ],
  });
  it("maps xyz:TICKER to signals, falls back to mark, drops thin markets", async () => {
    const s = await new HyperliquidStocks({ fetchImpl, retries: 0 }).signals();
    expect(s.get("NVDA")?.price).toBeCloseTo(191.1);
    expect(s.get("TSLA")?.price).toBeCloseTo(440.2);
    expect(s.has("THIN")).toBe(false);
  });
});

describe("BEP-677 fixed point", () => {
  it("converts 18-decimal multipliers", () => {
    expect(fromE18(1_002_100_000_000_000_000n)).toBeCloseTo(1.0021, 12);
    expect(fromE18(10n ** 18n)).toBe(1);
  });
});

import { parseStooqCsv } from "../src/index.js";
describe("Stooq daily bars", () => {
  it("parses the CSV and skips junk rows", () => {
    const bars = parseStooqCsv("Date,Open,High,Low,Close,Volume\n2026-10-02,186.5,190,185,189.2,1000\n2026-10-05,191.1,193,190,192.4,1200\nNo data\n");
    expect(bars).toHaveLength(2);
    expect(bars[1]).toMatchObject({ date: "2026-10-05", open: 191.1, close: 192.4 });
  });
  it("returns nothing for an error page", () => { expect(parseStooqCsv("Exceeded the daily hits limit")).toEqual([]); });
});

import { parseYahooChart, parseNasdaqHistorical } from "../src/index.js";
describe("ground truth parsers", () => {
  it("reads Yahoo daily bars with ET dates", () => {
    const j = { chart: { result: [{ meta: { dataGranularity: "1d" }, timestamp: [1791207000, 1791466200],
      indicators: { quote: [{ open: [186.5, 191.1], high: [190, 193], low: [185, 190], close: [189.2, null] }] } }] } };
    const r = parseYahooChart(j);
    expect(r.daily).toHaveLength(1);
    expect(r.daily[0]).toMatchObject({ date: "2026-10-05", open: 186.5, close: 189.2 });
  });
  it("reads Yahoo intraday bars", () => {
    const j = { chart: { result: [{ meta: { dataGranularity: "15m" }, timestamp: [1791207000, 1791207900], indicators: { quote: [{ open: [1, 2], close: [1.5, 2.5] }] } }] } };
    expect(parseYahooChart(j).intraday.map((b) => b.c)).toEqual([1.5, 2.5]);
  });
  it("reads Nasdaq historical rows", () => {
    const j = { data: { tradesTable: { rows: [{ date: "10/02/2026", open: "$186.50", high: "$190.00", low: "$185.00", close: "$1,189.20" }] } } };
    expect(parseNasdaqHistorical(j)[0]).toMatchObject({ date: "2026-10-02", open: 186.5, close: 1189.2 });
  });
});
