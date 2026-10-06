/**
 * Backtest over past weekends with real data. Run with internet access:
 *   npx tsx scripts/backtest.ts [weekends=8]
 *
 * Truth: Stooq daily bars (official Friday close, Monday open).
 * Inputs: Binance token k-lines (15m) per issuer, Hyperliquid xyz perp candles (15m).
 * Output: docs/SCORECARD.md and apps/engine/replay/backtest.json (also used by replay mode).
 *
 * Known approximation: multipliers are taken at today's value for all past weekends. A dividend
 * inside the window shifts that token's per-share price by the dividend yield (usually < 0.5%).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { backtestPeriod, alertOutcomes, score, sessionFor, isTradingDay, type PeriodResult, type TokenSeries } from "../packages/core/src/index.js";
import { BinanceRwa, HyperliquidStocks, BscScaledUi, stooqDaily } from "../packages/sources/src/index.js";

const WEEKENDS = Number(process.argv[2] ?? 8);
const bin = new BinanceRwa();
const hl = new HyperliquidStocks();
const bsc = new BscScaledUi();

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
  for (const type of [undefined, 1, 2, 3]) { try { for (const t of await bin.listTokens(type)) tokens.set(t.contract, t); } catch {} }
  const bscTokens = [...tokens.values()].filter((t) => (t.chainId === "56" || !t.chainId) && t.issuer !== "unknown");
  const perps = new Map((await hl.contexts()).filter((c) => (c.dayNtlVlm ?? 0) > 250_000).map((c) => [c.ticker, c.name]));
  const tickers = [...new Set(bscTokens.map((t) => t.ticker))].filter((t) => perps.has(t));
  console.log(`${bscTokens.length} BSC tokens; ${tickers.length} tickers also have a liquid Hyperliquid perp: ${tickers.join(", ")}`);

  const periods = weekendPeriods(WEEKENDS);
  const results: (PeriodResult & { closeDate: string; openDate: string })[] = [];

  for (const ticker of tickers) {
    let bars; try { bars = new Map((await stooqDaily(ticker)).map((b) => [b.date, b])); } catch (e) { console.log(`skip ${ticker}: ${e}`); continue; }
    const its = bscTokens.filter((t) => t.ticker === ticker);
    const mult = new Map<string, number>();
    for (const t of its) mult.set(t.contract, (await bsc.state(t.contract))?.current ?? t.multiplier ?? 1);

    for (const { closeDate, openDate } of periods) {
      const c = bars.get(closeDate), o = bars.get(openDate);
      if (!c || !o) continue;
      const lastCloseAt = sessionFor(closeDate)!.close, openAt = sessionFor(openDate)!.open;
      const series: TokenSeries[] = [];
      for (const t of its) {
        try {
          const k = await bin.klines(t.contract, "15m", 300, { startTime: lastCloseAt - 3_600_000, endTime: openAt + 3_600_000 });
          series.push({ issuer: t.issuer as TokenSeries["issuer"], symbol: t.symbol, contract: t.contract, multiplier: mult.get(t.contract)!, candles: k.map((x) => ({ t: x.closeTime || x.openTime, c: x.close })) });
        } catch (e) { console.log(`  klines ${t.symbol}: ${String(e).slice(0, 120)}`); }
      }
      const ext = (await hl.candles(perps.get(ticker)!, "15m", lastCloseAt - 3_600_000, openAt + 3_600_000)).map((x) => ({ t: x.t + 15 * 60_000, c: x.c, v: x.v * x.c }));
      const r = backtestPeriod({ ticker, lastClose: c.close, lastCloseAt, openAt, actualOpen: o.open, tokens: series, external: ext });
      results.push({ ...r, closeDate, openDate });
      console.log(`${ticker} ${closeDate}→${openDate}: close ${c.close} open ${o.open} | ours ${r.forecast.fairValue.toFixed(2)} tokens ${r.forecast.tokenOnly?.toFixed(2) ?? "-"} perp ${r.forecast.external?.toFixed(2) ?? "-"} | ${r.alerts.length} alerts`);
    }
  }

  const s = score(results.map((r) => r.forecast));
  const a = alertOutcomes(results.flatMap((r) => r.alerts));
  mkdirSync("apps/engine/replay", { recursive: true });
  writeFileSync("apps/engine/replay/backtest.json", JSON.stringify({ at: new Date().toISOString(), weekends: periods, results }, null, 2));
  const md = `# Afterhours scorecard (backtest)

Generated ${new Date().toISOString()} from real data: Binance token k-lines, Hyperliquid xyz perp candles, Stooq official daily bars.
${periods.length} weekends × ${tickers.length} tickers = ${s.n} forecasts scored. Forecast locked 5 minutes before the Monday open.

| Measure | Value |
|---|---|
| Our mean error vs the official open | ${s.maeBps.toFixed(1)} bps |
| Naive forecast (Friday close) | ${s.naiveMaeBps.toFixed(1)} bps |
| Tokens only (no perp signal) | ${s.tokenOnlyMaeBps?.toFixed(1) ?? "n/a"} bps |
| Error reduction vs naive | ${s.improvementPct.toFixed(1)}% |
| Direction of gaps ≥ 0.5% called correctly | ${(s.directionHitRate * 100).toFixed(0)}% |
| Alerts raised | ${a.n} |
| Alerts worth acting on at the open, after costs | ${(a.winRate * 100).toFixed(0)}% |
| Average alert value at the open, after costs | ${(a.avgNetPct * 100).toFixed(2)}% |

Approximation: multipliers are today's values for every past weekend.
`;
  writeFileSync("docs/SCORECARD.md", md);
  console.log("\n" + md);
}

main().catch((e) => { console.error(e); process.exit(1); });
