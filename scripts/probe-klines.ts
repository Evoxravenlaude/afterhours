/**
 * Which k-line request shapes does Binance accept? (DX-REPORT F14)
 *   npx tsx scripts/probe-klines.ts > docs/klines-probe.txt
 */
import { BinanceRwa, type KlineInterval } from "../packages/sources/src/index.js";

const bin = new BinanceRwa({ retries: 0 });
const NVDAB = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436";
const H = 3_600_000, now = Date.now();

async function main() {
  const windows: [string, { startTime?: number; endTime?: number } | undefined][] = [
    ["no window", undefined],
    ["start+end 24h", { startTime: now - 48 * H, endTime: now - 24 * H }],
    ["start+end 7d", { startTime: now - 8 * 24 * H, endTime: now - 24 * H }],
    ["end only", { endTime: now - 7 * 24 * H }],
    ["start only", { startTime: now - 7 * 24 * H }],
  ];
  for (const interval of ["15m", "1h"] as KlineInterval[]) for (const limit of [100, 200, 300, 500]) for (const [name, w] of windows) {
    try {
      const k = await bin.klines(NVDAB, interval, limit, w);
      const span = k.length ? `${new Date(k[0].openTime).toISOString()} → ${new Date(k.at(-1)!.openTime).toISOString()}` : "";
      console.log(`OK   ${interval} limit=${limit} ${name}: ${k.length} candles ${span}`);
    } catch (e) { console.log(`FAIL ${interval} limit=${limit} ${name}: ${String(e).slice(0, 100)}`); }
  }
}
main();
