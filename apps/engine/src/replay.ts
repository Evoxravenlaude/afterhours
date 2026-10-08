import { readFileSync, existsSync } from "node:fs";
import type { Store } from "./store.js";

/**
 * Replay mode: load the real-data backtest (scripts/backtest.ts) into the store so the scorecard,
 * alert history and morning cards render without API access. Nothing here is synthetic: every
 * forecast and alert came from recorded Binance k-lines, Hyperliquid candles and Stooq daily bars.
 */
export function seedFromBacktest(store: Store, path: string): { forecasts: number; alerts: number } {
  if (!existsSync(path)) return { forecasts: 0, alerts: 0 };
  const data = JSON.parse(readFileSync(path, "utf8"));
  let f = 0, a = 0;
  for (const r of data.results ?? []) {
    store.upsertForecast(r.forecast);
    if (r.forecast.actualOpen) store.settleForecast(r.forecast.ticker, r.forecast.openAt, r.forecast.actualOpen);
    f++;
    for (const al of r.alerts ?? []) {
      const id = store.insertAlert(al, r.forecast.periodStart);
      store.settleAlert(id, r.forecast.actualOpen, al.worthPct, al.exitPct);
      a++;
    }
  }
  return { forecasts: f, alerts: a };
}
