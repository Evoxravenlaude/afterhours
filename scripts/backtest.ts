/**
 * Backtest over past weekends with real data. Run with internet access:
 *   npx tsx scripts/backtest.ts [weekends=8]
 *
 * Truth: official Friday close and Monday open (Yahoo chart API, Nasdaq fallback, Stooq last).
 * Inputs: Binance token k-lines (15m, or 1h if 15m is refused; paged at 200 per request) per issuer, Hyperliquid xyz perp candles (15m).
 * Basis: each token's normal ratio to the real price, learned from Friday's session against 15-minute bars.
 * Output: docs/SCORECARD.md and apps/engine/replay/backtest.json (also used by replay mode).
 *
 * Known approximation: multipliers are taken at today's value for all past weekends. A dividend
 * inside the window shifts that token's per-share price by the dividend yield (usually < 0.5%).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_MODEL, DEFAULT_COSTS, backtestPeriod, alertOutcomes, score, sessionFor, isTradingDay, estimateBasis, issuerLabel, type PeriodResult, type TokenSeries } from "../packages/core/src/index.js";
import { BinanceRwa, HyperliquidStocks, dailyBars, intradayBars, type Kline, type KlineInterval } from "../packages/sources/src/index.js";

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

/** Token candles over a window: 15-minute if the endpoint serves them, else hourly. */
let klineInterval: KlineInterval | undefined;
async function tokenCandles(contract: `0x${string}`, start: number, end: number): Promise<{ k: Kline[]; interval: number }> {
  const order: KlineInterval[] = klineInterval ? [klineInterval] : ["15m", "1h"];
  let last: unknown;
  for (const iv of order) {
    try {
      const k = await bin.klinesRange(contract, iv, start, end);
      if (!klineInterval) console.log(`  k-lines: interval ${iv}, request shape "${bin.klineShape}"`);
      klineInterval = iv;
      return { k, interval: iv === "15m" ? 900_000 : 3_600_000 };
    } catch (e) { last = e; }
  }
  throw last;
}
let klineCount = 0;
const coverage = new Map<string, { candles: number[]; withBasis: number; matched: number[]; ratios: number[]; session: number[] }>();
const diag = new Set<string>();

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
      // Keyed by bar end, so a 15m or 1h token candle compares with the official price at the same instant.
      const truthAt = new Map(intraday.filter((b) => b.t >= fri.open && b.t < fri.close).map((b) => [b.t + 15 * 60_000, b.c]));
      const series: TokenSeries[] = [];
      for (const t of its) {
        try {
          const { k, interval } = await tokenCandles(t.contract, fri.open, openAt + 6 * 3_600_000);
          const end = (x: { openTime: number; closeTime: number }) => (x.closeTime ? x.closeTime + 1 : x.openTime + interval);
          const m = mult.get(t.contract)!;
          const basis = estimateBasis(k.filter((x) => truthAt.has(end(x))).map((x) => ({ tokenShare: x.close / m, truth: truthAt.get(end(x))! })));
          if (basis) basisLog.push({ issuer: t.issuer, basis });
          const cv = coverage.get(t.issuer) ?? { candles: [], withBasis: 0, matched: [], ratios: [], session: [] };
          const inSession = k.filter((x) => x.openTime >= fri.open && x.openTime < fri.close);
          const pairs = k.filter((x) => truthAt.has(end(x))).map((x) => x.close / m / truthAt.get(end(x))!);
          cv.candles.push(k.filter((x) => x.openTime < openAt).length); cv.session.push(inSession.length); cv.matched.push(pairs.length); cv.ratios.push(...pairs);
          if (basis) cv.withBasis++; coverage.set(t.issuer, cv);
          if (!basis && inSession.length && pairs.length === 0 && !diag.has(t.issuer)) {
            diag.add(t.issuer);
            console.log(`  basis diag ${t.symbol}: ${inSession.length} session candles, e.g. openTime ${new Date(inSession[0].openTime).toISOString()} closeTime ${inSession[0].closeTime}; truth bar ends e.g. ${[...truthAt.keys()].slice(0, 2).map((x) => new Date(x).toISOString()).join(", ")} (${truthAt.size} bars)`);
          }
          series.push({ issuer: t.issuer as TokenSeries["issuer"], symbol: t.symbol, contract: t.contract, multiplier: m, basis, candles: k.map((x) => ({ t: end(x), c: x.close })) });
          klineCount += k.length;
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
  const all = results.flatMap((r) => r.alerts);
  const costPct = DEFAULT_COSTS.costPct({} as any);
  const a = alertOutcomes(all, costPct);
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const issuerAlertRows = [...new Set(all.map((x) => x.issuer))].map((i) => {
    const o = alertOutcomes(all.filter((x) => x.issuer === i), costPct);
    return `| ${issuerLabel(i)} | ${o.n} | ${o.traded.n ? (o.traded.winRate * 100).toFixed(0) + "% of " + o.traded.n : "–"} | ${o.traded.n ? pct(o.traded.avgNetPct) : "–"} | ${pct(o.atOpen.avgNetPct)} |`;
  }).join("\n") || "| – | 0 | – | – | – |";
  const med = (xs: number[]) => { const m = [...xs].sort((x, y) => x - y); return m.length ? m[m.length >> 1] : NaN; };
  const coverageRows = [...coverage].map(([i, c]) => `| ${issuerLabel(i)} | ${c.candles.length} | ${med(c.candles)} | ${med(c.session)} | ${med(c.matched)} | ${c.ratios.length ? ((med(c.ratios) - 1) * 100).toFixed(2) + "%" : "–"} | ${c.withBasis} of ${c.candles.length} |`).join("\n");
  const both = results.map((r) => r.forecast).filter((f) => f.external && f.tokenOnly);
  const sweep = [0, 0.3, 0.5, 0.7, 0.9, 1].map((w) => ({ w, bps: both.length ? both.reduce((acc, f) => acc + Math.abs(Math.exp(Math.log(f.lastClose) + w * Math.log(f.external! / f.lastClose) + (1 - w) * Math.log(f.tokenOnly! / f.lastClose)) / f.actualOpen! - 1) * 1e4, 0) / both.length : NaN }));
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
| Token candles loaded | ${klineCount}${klineInterval ? ` (${klineInterval}, request shape "${bin.klineShape}")` : ""} |

## Alerts

An alert is worth something only if the token itself moves. "Traded" buys (or sells) the token at the alert price and exits at that token's first traded price after the open; "vs official open" compares the alert price with the stock's opening print, which a token holder can't always realise (a token that keeps its discount after the open shows a paper win). Costs: ${(costPct * 100).toFixed(2)}% round trip.

| Measure | Traded (realisable) | vs official open (paper) |
|---|---|---|
| Alerts | ${a.traded.n} of ${a.n} (${a.noExit} had no trade within 6h of the open) | ${a.n} |
| Worth acting on after costs | ${(a.traded.winRate * 100).toFixed(0)}% | ${(a.atOpen.winRate * 100).toFixed(0)}% |
| Average value after costs | ${(a.traded.avgNetPct * 100).toFixed(2)}% | ${(a.atOpen.avgNetPct * 100).toFixed(2)}% |

| Issuer | Alerts | Traded: won after costs | Traded: average after costs | Paper: average after costs |
|---|---|---|---|---|
${issuerAlertRows}

## Token data coverage

Medians per token-weekend. A basis needs at least 6 Friday-session candles that line up with an official 15-minute bar and sit within 10% of it.

| Issuer | Token-weekends | Candles (Fri open → Mon open) | In Friday session | Matched to official bars | Raw token/stock gap | Basis learned |
|---|---|---|---|---|---|---|
${coverageRows}

## How much weight the tokens deserve in the forecast

Error vs the official open when fair value blends the perp (weight w) with the token consensus (1 − w), recomputed from this run's inputs. The live default is w = ${DEFAULT_MODEL.externalWeight}.

| w | ${sweep.map((x) => x.w.toFixed(1)).join(" | ")} |
|---|${sweep.map(() => "---").join("|")}|
| Error (bps) | ${sweep.map((x) => x.bps.toFixed(1)).join(" | ")} |

## Issuer basis while the exchange is open

How far each issuer's tokens normally sit from the real stock price (per share, after the multiplier), measured on Friday sessions. Afterhours measures closed-hours moves from this level, not from zero.

| Issuer | Token-weekends | Median | Range |
|---|---|---|---|
${basisRows || "| n/a | 0 | – | – |"}

${klineCount ? "" : "**No token candles loaded: the token and alert layers are not scored in this run; the figures above are the perp signal alone.**\n\n"}Approximations: multipliers are today's values for every past weekend. Where official daily bars were unreachable, the Friday close and Monday open come from the Hyperliquid oracle's 15-minute candles (counted separately above); that proxy shares a source with the perp signal, so official-print rows are the stronger evidence.${skipped.length ? `\nSkipped (no official bars): ${skipped.join(", ")}.` : ""}
`;
  writeFileSync("docs/SCORECARD.md", md);
  console.log("\n" + md);
}

main().catch((e) => { console.error(e); process.exit(1); });
