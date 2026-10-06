import type { ExternalSignal } from "@afterhours/core";
import { getJson, num, type HttpOptions } from "./http.js";

/**
 * Hyperliquid HIP-3 stock perpetuals (trade.xyz deploys them on the "xyz" perp dex).
 * They track the Nasdaq/NYSE price via oracle while the exchange is open and keep trading 24/7,
 * which makes the mid price an independent closed-market signal.
 */
export const HL_INFO = "https://api.hyperliquid.xyz/info";

export interface PerpCtx { name: string; ticker: string; midPx?: number; markPx?: number; oraclePx?: number; dayNtlVlm?: number; openInterest?: number }

export class HyperliquidStocks {
  constructor(private opts: HttpOptions & { url?: string; dex?: string } = {}) {}

  async contexts(): Promise<PerpCtx[]> {
    const res = await getJson<[any, any[]]>(this.opts.url ?? HL_INFO, { ...this.opts, method: "POST", body: { type: "metaAndAssetCtxs", dex: this.opts.dex ?? "xyz" } });
    const universe: any[] = res?.[0]?.universe ?? [];
    const ctxs: any[] = res?.[1] ?? [];
    return universe.map((u, i) => {
      const name = String(u?.name ?? "");
      const c = ctxs[i] ?? {};
      return {
        name, ticker: name.includes(":") ? name.split(":")[1].toUpperCase() : name.toUpperCase(),
        midPx: num(c.midPx), markPx: num(c.markPx), oraclePx: num(c.oraclePx), dayNtlVlm: num(c.dayNtlVlm), openInterest: num(c.openInterest),
      };
    });
  }

  /** One signal per ticker. Mid price preferred (what trades), mark price as fallback. Thin markets are dropped. */
  async signals(minDayVolumeUsd = 250_000): Promise<Map<string, ExternalSignal>> {
    const out = new Map<string, ExternalSignal>();
    const now = Date.now();
    for (const c of await this.contexts()) {
      const price = c.midPx ?? c.markPx;
      if (!price || (c.dayNtlVlm ?? 0) < minDayVolumeUsd) continue;
      out.set(c.ticker, { source: "hyperliquid", ticker: c.ticker, price, observedAt: now, volume24hUsd: c.dayNtlVlm });
    }
    return out;
  }
}
