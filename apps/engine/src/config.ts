import { DEFAULT_MODEL, DEFAULT_COSTS, type ModelConfig, type CostModel } from "@afterhours/core";

const n = (k: string, d: number) => (process.env[k] !== undefined ? Number(process.env[k]) : d);

export const config = {
  port: n("PORT", 8787),
  dbPath: process.env.DB_PATH ?? "data/afterhours.db",
  tickMs: n("TICK_MS", 60_000),
  /** Only alert while the exchange is closed (the product's point), unless overridden for testing. */
  closedOnly: process.env.CLOSED_ONLY !== "false",
  /** "live" hits the APIs; "replay" loads the real-data backtest from scripts/backtest.ts. */
  mode: (process.env.MODE ?? "live") as "live" | "replay",
  replayPath: process.env.REPLAY_PATH ?? "apps/engine/replay/backtest.json",
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:8787",
  /** Minutes before the open to lock the forecast, and after the open to read the opening print. */
  forecastLeadMin: n("FORECAST_LEAD_MIN", 5),
  openReadDelayMin: n("OPEN_READ_DELAY_MIN", 2),
  model: { ...DEFAULT_MODEL, externalWeight: n("EXTERNAL_WEIGHT", DEFAULT_MODEL.externalWeight) } satisfies ModelConfig,
  costs: { ...DEFAULT_COSTS, minNetEdgePct: n("MIN_NET_EDGE", DEFAULT_COSTS.minNetEdgePct) } satisfies CostModel,
};
export type Config = typeof config;
