import type { TokenQuote, ExternalSignal, GuardState, Issuer } from "@afterhours/core";
import { BinanceRwa, HyperliquidStocks, BscScaledUi, type ListedToken, type PerpCtx } from "@afterhours/sources";

export interface TickerSnapshot {
  quotes: TokenQuote[];
  external?: ExternalSignal;
  guards: GuardState[];
  /** Binance's stockInfo.price. Only a fallback for the last close; see DX-REPORT F2. */
  stockPrice?: number;
  /** Hyperliquid oracle price: tracks the exchange while it's open. Used to capture the close and the opening print. */
  oraclePx?: number;
}

export interface Snapshot { now: number; tickers: Map<string, TickerSnapshot> }

/** Small TTL cache so slow-moving data (token list, multipliers, statuses) isn't refetched every tick. */
class Ttl<T> {
  private v = new Map<string, { at: number; v: T }>();
  constructor(private ms: number) {}
  async get(k: string, load: () => Promise<T>): Promise<T> {
    const hit = this.v.get(k);
    if (hit && Date.now() - hit.at < this.ms) return hit.v;
    const v = await load(); this.v.set(k, { at: Date.now(), v }); return v;
  }
}

export class LiveCollector {
  private listCache = new Ttl<ListedToken[]>(60 * 60_000);
  private multCache = new Ttl<Awaited<ReturnType<BscScaledUi["state"]>>>(10 * 60_000);
  private statusCache = new Ttl<Awaited<ReturnType<BinanceRwa["assetStatus"]>> | null>(5 * 60_000);

  constructor(
    private bin = new BinanceRwa(),
    private hl = new HyperliquidStocks(),
    private bsc = new BscScaledUi(),
    private tokenTypes: (number | undefined)[] = (process.env.TOKEN_TYPES ?? "none,1,2,3").split(",").map((x) => (x === "none" ? undefined : Number(x))),
  ) {}

  async tokens(): Promise<ListedToken[]> {
    return this.listCache.get("all", async () => {
      const m = new Map<string, ListedToken>();
      for (const t of this.tokenTypes) { try { for (const x of await this.bin.listTokens(t)) m.set(x.contract, x); } catch {} }
      return [...m.values()].filter((t) => (t.chainId === "56" || !t.chainId) && t.issuer !== "unknown");
    });
  }

  async snapshot(): Promise<Snapshot> {
    const now = Date.now();
    const [tokens, ctxs] = await Promise.all([this.tokens(), this.hl.contexts().catch(() => [] as PerpCtx[])]);
    const perps = new Map(ctxs.map((c) => [c.ticker, c]));
    const out = new Map<string, TickerSnapshot>();

    await Promise.all(tokens.map(async (t) => {
      const snap = out.get(t.ticker) ?? { quotes: [], guards: [] };
      out.set(t.ticker, snap);
      try {
        const [d, ms, st] = await Promise.all([
          this.bin.dynamic(t.contract),
          this.multCache.get(t.contract, () => this.bsc.state(t.contract)),
          this.statusCache.get(t.contract, () => this.bin.assetStatus(t.contract).catch(() => null)),
        ]);
        if (d.stockPrice) snap.stockPrice = d.stockPrice;
        const multiplier = ms?.current ?? d.sharesMultiplier ?? t.multiplier ?? 1;
        if (d.tokenPrice) snap.quotes.push({ issuer: t.issuer as Issuer, symbol: t.symbol, ticker: t.ticker, contract: t.contract, tokenPrice: d.tokenPrice, multiplier, liquidityUsd: d.volume24h, observedAt: now });
        if (ms?.pending) snap.guards.push({ ticker: t.ticker, pendingMultiplier: { ...ms.pending, issuer: t.issuer as Issuer } });
        if (st) snap.guards.push({ ticker: t.ticker, assetStatus: { issuer: t.issuer as Issuer, openState: st.openState, reasonCode: st.reasonCode } });
      } catch { /* one bad token must not sink the tick */ }
    }));

    for (const [ticker, snap] of out) {
      const p = perps.get(ticker);
      if (!p) continue;
      snap.oraclePx = p.oraclePx;
      const price = p.midPx ?? p.markPx;
      if (price && (p.dayNtlVlm ?? 0) >= 250_000) snap.external = { source: "hyperliquid", ticker, price, observedAt: now, volume24hUsd: p.dayNtlVlm };
    }
    return { now, tickers: out };
  }
}
