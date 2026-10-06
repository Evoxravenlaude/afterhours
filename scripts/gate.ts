/**
 * Gate check: run this on a machine with internet access.
 *   npx tsx scripts/gate.ts
 * It hits every data source Afterhours depends on, prints PASS/FAIL per check,
 * and saves raw responses to packages/sources/test/fixtures/live/ so the parsers can be locked to real shapes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { BinanceRwa, BINANCE_BASE, BINANCE_HEADERS, HyperliquidStocks, HL_INFO, BscScaledUi } from "../packages/sources/src/index.js";

const OUT = "packages/sources/test/fixtures/live";
mkdirSync(OUT, { recursive: true });

const results: { check: string; ok: boolean; note: string }[] = [];
const record = (check: string, ok: boolean, note: string) => { results.push({ check, ok, note }); console.log(`${ok ? "PASS" : "FAIL"}  ${check}  ${note}`); };

// Capture raw bodies by wrapping fetch.
const raw: Record<string, unknown> = {};
const capturingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const text = await res.clone().text();
  const key = String(input).replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 120) + (init?.body ? "_" + String(init.body).replace(/[^a-z0-9]+/gi, "_").slice(0, 40) : "");
  try { raw[key] = JSON.parse(text); } catch { raw[key] = text; }
  return res;
};

const bin = new BinanceRwa({ fetchImpl: capturingFetch });
const hl = new HyperliquidStocks({ fetchImpl: capturingFetch });
const bsc = new BscScaledUi();

async function main() {
  console.log(`Binance base: ${BINANCE_BASE}\nHeaders: ${JSON.stringify(BINANCE_HEADERS)}\nHyperliquid: ${HL_INFO}\n`);

  // 1. Token list: which issuers does the API actually return? (DX-REPORT F1)
  const all = new Map<string, Awaited<ReturnType<BinanceRwa["listTokens"]>>[number]>();
  for (const type of [undefined, 0, 1, 2, 3, 4, 5]) {
    try {
      const list = await bin.listTokens(type);
      for (const t of list) all.set(t.contract, t);
      record(`token list type=${type ?? "none"}`, list.length > 0, `${list.length} tokens; issuers: ${[...new Set(list.map((t) => t.issuer))].join(",")}`);
    } catch (e) { record(`token list type=${type ?? "none"}`, false, String(e).slice(0, 160)); }
  }
  const bscTokens = [...all.values()].filter((t) => t.chainId === "56" || t.chainId === "");
  const byIssuer = new Map<string, number>();
  for (const t of bscTokens) byIssuer.set(t.issuer, (byIssuer.get(t.issuer) ?? 0) + 1);
  record("BSC tokens across issuers", byIssuer.size >= 2, JSON.stringify(Object.fromEntries(byIssuer)));

  // 2. Dynamic data on a sample per issuer, and is referencePrice/stockPrice independent? (DX-REPORT F2)
  const sample = ["ondo", "bstocks", "xstocks", "unknown"].map((i) => bscTokens.find((t) => t.issuer === i)).filter(Boolean) as typeof bscTokens;
  for (const t of sample) {
    try {
      const d = await bin.dynamic(t.contract);
      const ratio = d.tokenPrice && d.stockPrice ? (d.tokenPrice / (d.sharesMultiplier ?? 1)) / d.stockPrice : undefined;
      record(`dynamic ${t.symbol} (${t.issuer})`, !!d.tokenPrice, `token=${d.tokenPrice} stock=${d.stockPrice} mult=${d.sharesMultiplier} share/stock=${ratio?.toFixed(5)}`);
    } catch (e) { record(`dynamic ${t.symbol}`, false, String(e).slice(0, 160)); }
  }

  // 3. Market and asset status, including corporate-action reason codes.
  try { const m = await bin.marketStatus(); record("market status", !!m.openState, JSON.stringify(m)); } catch (e) { record("market status", false, String(e).slice(0, 160)); }
  for (const t of sample.slice(0, 2)) {
    try { const s = await bin.assetStatus(t.contract); record(`asset status ${t.symbol}`, !!s.openState, JSON.stringify(s)); } catch (e) { record(`asset status ${t.symbol}`, false, String(e).slice(0, 160)); }
  }

  // 4. K-lines (history for calibration and the scorecard).
  if (sample[0]) {
    try { const k = await bin.klines(sample[0].contract, "1h", 200); record(`klines ${sample[0].symbol}`, k.length > 0, `${k.length} candles; last close ${k.at(-1)?.close}`); } catch (e) { record("klines", false, String(e).slice(0, 160)); }
  }

  // 5. Hyperliquid stock perps: the independent 24/7 signal.
  try {
    const ctx = await hl.contexts();
    const liquid = ctx.filter((c) => (c.dayNtlVlm ?? 0) > 250_000);
    const overlap = liquid.filter((c) => bscTokens.some((t) => t.ticker === c.ticker)).map((c) => c.ticker);
    record("hyperliquid xyz perps", ctx.length > 0, `${ctx.length} markets, ${liquid.length} liquid; overlap with BSC tokens: ${overlap.join(",") || "none"}`);
  } catch (e) { record("hyperliquid xyz perps", false, String(e).slice(0, 160)); }

  // 6. BEP-677 on chain: which tokens expose uiMultiplier, and any pending changes?
  let bep = 0;
  for (const t of bscTokens.slice(0, 30)) {
    const s = await bsc.state(t.contract);
    if (s) { bep++; if (s.pending) console.log(`      pending ${t.symbol}: ${s.current} -> ${s.pending.multiplier} at ${new Date(s.pending.effectiveAt).toISOString()}`); }
  }
  record("BEP-677 uiMultiplier readable", bep > 0, `${bep} of ${Math.min(30, bscTokens.length)} BSC tokens`);

  writeFileSync(`${OUT}/tokens.json`, JSON.stringify(bscTokens, null, 2));
  writeFileSync(`${OUT}/raw.json`, JSON.stringify(raw, null, 2));
  writeFileSync(`${OUT}/gate-results.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Raw responses saved to ${OUT}/.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
