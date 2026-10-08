/**
 * Backtest over past weekends with real data. Run with internet access:
 *   npx tsx scripts/backtest.ts [weekends=8]
 *
 * Truth: official Friday close and Monday open (Yahoo chart API, Nasdaq fallback, Stooq last).
 * Inputs: Binance token k-lines (15m) per issuer, Hyperliquid xyz perp candles (15m).
 * Basis: each token's normal ratio to the real price, learned from Friday's session against 15-minute bars.
 * Output: docs/SCORECARD.md and apps/engine/replay/backtest.json (also used by replay mode).
 *
 * Known approximation: multipliers are taken at today's value for all past weekends. A dividend
 * inside the window shifts that token's per-share price by the dividend yield (usually < 0.5%).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { backtestPeriod, alertOutcomes, score, sessionFor, isTradingDay, estimateBasis, issuerLabel, type PeriodResult, type TokenSeries } from "../packages/core/src/index.js";
import { BinanceRwa, HyperliquidStocks, dailyBars, intradayBars } from "../packages/sources/src/index.js";

const WEEKENDS = Number(process.argv[2] ?? 8);
const bin = new BinanceRwa();
const hl = new HyperliquidStocks();

function addDays(d: string, n: number) { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

/** Last N closed periods spanning a weekend: (last trading day before, first trading day after). */
function weekendPeriods(n: number): { closeDate: string; openDate: string }[] {
  const out: { closeDate: string; openDate: string }[] = [];
  let d = new Date().toISOString().slice(0, 10);
  while (out.length < n) {
    d = addDays(d, -1);
    const wd = new Date(d + "T12:00:00Z").getUTCDay();
    if (wd !== 5 && !(wd === 4 && !isTradingDay(addDays(d, 1)))) continue;
    if (!isTradingDay(d)) continue;
    let o = addDays(d, 1);
    while (!isTradingDay(o)) o = addDays(o, 1);
    if (sessionFor(o)!.open > Date.now()) continue;
    out.push({ closeDate: d, openDate: o });
  }
  return out;
}

async function main() {
  const tokens = new Map<string, Awaited<ReturnType<BinanceRwa["listTokens"]>>[number]>();
  for (const type of [undefined, 1, 2, 3, 4, 5]) { try { for (const t of await bin.listTokens(type)) tokens.set(`${t.chainId}:${t.contract}`, t); } catch {} }
  const bscTokens = [...tokens.values()].filter((t) => t.chainId === "56" && t.issuer !== "unknown");
  const perps = new Map((await hl.contexts()).filter((c) => (c.dayNtlVlm ?? 0) > 250_000).map((c) => [c.ticker, c.name]));
  const only = process.env.TICKERS?.split(",").map((x) => x.trim().toUpperCase());
  const tickers = [...new Set(bscTokens.map((t) => t.ticker))].filter((t) => perps.has(t) && (!only || only.includes(t)));
  console.log(`${bscTokens.length} BSC tokens; ${tickers.length} tickers also have a liquid Hyperliquid perp: ${tickers.join(", ")}`);

  const periods = weekendPeriods(WEEKENDS);
  const results: (PeriodResult & { closeDate: string; openDate: string })[] = [];
  const basisLog: { issuer: string; basis: number }[] = [];
  const skipped: string[] = [];

  for (const ticker of tickers) {
    let truth: { bars: { date: string; open: number; close: number }[]; source: string };
    try { truth = await dailyBars(ticker); }
    catch (e) { console.log(`  ${ticker}: no official bars (${String(e).slice(0, 100)}); using the Hyperliquid oracle proxy`); truth = { bars: [], source: "hl-proxy" }; }
    const bars = new Map(truth.bars.map((b) => [b.date, b]));
    const intraday = await intradayBars(ticker).catch(() => []);
    const its = bscTokens.filter((t) => t.ticker === ticker);
    // Multipliers from the Binance API (on-chain BEP-677 reads failed for these issuers in the gate run).
    const mult = new Map<string, number>();
    await Promise.all(its.map(async (t) => mult.set(t.contract, (await bin.dynamic(t.contract).catch(() => null))?.sharesMultiplier ?? t.multiplier ?? 1)));

    for (const { closeDate, openDate } of periods) {
      const fri = sessionFor(closeDate)!, lastCloseAt = fri.close, openAt = sessionFor(openDate)!.open;
      let c: { date: string; open: number; close: number } | undefined = bars.get(closeDate), o = bars.get(openDate), source = truth.source;
      if (!c || !o) {
        // Proxy: the perp's oracle tracks the exchange while it's open, so the last 15m candle before the close
        // and the first after the open sit within a few bps of the official prints. Labelled separately.
        const hk = await hl.candles(perps.get(ticker)!, "15m", lastCloseAt - 30 * 60_000, openAt + 30 * 60_000).catch(() => []);
        const pc = hk.find((x) => x.t === lastCloseAt - 15 * 60_000), po = hk.find((x) => x.t === openAt);
        if (!pc || !po) { skipped.push(`${ticker} ${closeDate}`); continue; }
        c = { date: closeDate, open: pc.o, close: pc.c }; o = { date: openDate, open: po.o, close: po.c }; source = "hl-proxy";
      }
      const truthAt = new Map(intraday.filter((b) => b.t >= fri.open && b.t < fri.close).map((b) => [b.t, b.c]));
      const series: TokenSeries[] = [];
      for (const t of its) {
        try {
          const k = await bin.klines(t.contract, "15m", 300, { startTime: fri.open, endTime: openAt + 3_600_000 });
          const m = mult.get(t.contract)!;
          const basis = estimateBasis(k.filter((x) => truthAt.has(x.openTime)).map((x) => ({ tokenShare: x.close / m, truth: truthAt.get(x.openTime)! })));
          if (basis) basisLog.push({ issuer: t.issuer, basis });
          series.push({ issuer: t.issuer as TokenSeries["issuer"], symbol: t.symbol, contract: t.contract, multiplier: m, basis, candles: k.map((x) => ({ t: x.closeTime || x.openTime + 15 * 60_000, c: x.close })) });
        } catch (e) { console.log(`  klines ${t.symbol}: ${String(e).slice(0, 120)}`); }
      }
      const ext = (await hl.candles(perps.get(ticker)!, "15m", lastCloseAt - 3_600_000, openAt + 3_600_000).catch(() => [])).map((x) => ({ t: x.t + 15 * 60_000, c: x.c, v: x.v * x.c }));
      const r = backtestPeriod({ ticker, lastClose: c.close, lastCloseAt, openAt, actualOpen: o.open, tokens: series, external: ext });
      results.push({ ...r, closeDate, openDate, truth: source } as any);
      console.log(`${ticker} ${closeDate}→${openDate} [${source}]: close ${c.close} open ${o.open} | ours ${r.forecast.fairValue.toFixed(2)} tokens ${r.forecast.tokenOnly?.toFixed(2) ?? "-"} perp ${r.forecast.external?.toFixed(2) ?? "-"} | bases ${series.map((s) => s.basis?.toFixed(4) ?? "-").join("/")} | ${r.alerts.length} alerts`);
    }
  }

  const issuerBasis = new Map<string, number[]>();
  for (const b of basisLog) issuerBasis.set(b.issuer, [...(issuerBasis.get(b.issuer) ?? []), b.basis]);
  const basisRows = [...issuerBasis].map(([i, xs]) => { const s = [...xs].sort((a, b) => a - b); return `| ${issuerLabel(i)} | ${xs.length} | ${((s[s.length >> 1] - 1) * 100).toFixed(2)}% | ${((s[0] - 1) * 100).toFixed(2)}% to ${((s[s.length - 1] - 1) * 100).toFixed(2)}% |`; }).join("\n");
  const s = score(results.map((r) => r.forecast));
  const official = score(results.filter((r: any) => r.truth !== "hl-proxy").map((r) => r.forecast));
  const proxy = score(results.filter((r: any) => r.truth === "hl-proxy").map((r) => r.forecast));
  const a = alertOutcomes(results.flatMap((r) => r.alerts));
  mkdirSync("apps/engine/replay", { recursive: true });
  writeFileSync("apps/engine/replay/backtest.json", JSON.stringify({ at: new Date().toISOString(), weekends: periods, results }, null, 2));
  const md = `# Afterhours scorecard (backtest)

Generated ${new Date().toISOString()} from real data: Binance token k-lines, Hyperliquid xyz perp candles, official daily bars (Yahoo / Nasdaq).
${periods.length} weekends × ${tickers.length} tickers = ${s.n} forecasts scored. Forecast locked 5 minutes before the Monday open.

| Measure | Value |
|---|---|
| Our mean error vs the official open | ${s.maeBps.toFixed(1)} bps |
| Naive forecast (Friday close) | ${s.naiveMaeBps.toFixed(1)} bps |
| Tokens only (no perp signal) | ${s.tokenOnlyMaeBps?.toFixed(1) ?? "n/a"} bps |
| Error reduction vs naive | ${s.improvementPct.toFixed(1)}% |
| Direction of gaps ≥ 0.5% called correctly | ${(s.directionHitRate * 100).toFixed(0)}% |
| Scored against official prints / Hyperliquid oracle proxy | ${official.n} / ${proxy.n} |
| Our error, official prints only | ${official.n ? official.maeBps.toFixed(1) + " bps vs " + official.naiveMaeBps.toFixed(1) + " naive" : "n/a"} |
| Alerts raised | ${a.n} |
| Alerts worth acting on at the open, after costs | ${(a.winRate * 100).toFixed(0)}% |
| Average alert value at the open, after costs | ${(a.avgNetPct * 100).toFixed(2)}% |

## Issuer basis while the exchange is open

How far each issuer's tokens normally sit from the real stock price (per share, after the multiplier), measured on Friday sessions. Afterhours measures closed-hours moves from this level, not from zero.

| Issuer | Token-weekends | Median | Range |
|---|---|---|---|
${basisRows || "| n/a | 0 | – | – |"}

Approximations: multipliers are today's values for every past weekend. Where official daily bars were unreachable, the Friday close and Monday open come from the Hyperliquid oracle's 15-minute candles (counted separately above); that proxy shares a source with the perp signal, so official-print rows are the stronger evidence.${skipped.length ? `\nSkipped (no official bars): ${skipped.join(", ")}.` : ""}
`;
  writeFileSync("docs/SCORECARD.md", md);
  console.log("\n" + md);
}

main().catch((e) => { console.error(e); process.exit(1); });
