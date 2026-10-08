import type { Issuer, TokenQuote } from "@afterhours/core";
import { getJson, num, type HttpOptions } from "./http.js";

/**
 * Binance Web3 tokenized-securities endpoints (public, no key), as documented in the
 * binance-tokenized-securities-info skill. Responses use Binance's usual envelope:
 * { code: "000000", message, data, success }.
 */
export const BINANCE_BASE = "https://www.binance.com/bapi/defi";
export const BSC_CHAIN_ID = "56";

const PATHS = {
  list: "/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai",
  meta: "/v1/public/wallet-direct/buw/wallet/market/token/rwa/meta/ai",
  marketStatus: "/v1/public/wallet-direct/buw/wallet/market/token/rwa/market/status/ai",
  assetStatus: "/v1/public/wallet-direct/buw/wallet/market/token/rwa/asset/market/status/ai",
  dynamic: "/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai",
  kline: "/v1/public/wallet-direct/buw/wallet/dex/market/token/kline/ai",
} as const;

export const BINANCE_HEADERS = { "Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)" };

export interface Envelope<T> { code?: string; message?: string | null; data?: T; success?: boolean }

export class BinanceApiError extends Error {
  constructor(public code: string | undefined, msg: string | null | undefined, public path: string) {
    super(`Binance ${path}: code=${code} ${msg ?? ""}`);
  }
}

export interface ListedToken {
  chainId: string;
  contract: `0x${string}`;
  symbol: string;
  ticker: string;
  type?: number;
  multiplier?: number;
  issuer: Issuer | "unknown";
}

export interface DynamicInfo {
  symbol: string;
  ticker: string;
  tokenPrice?: number;
  sharesMultiplier?: number;
  volume24h?: number;
  holders?: number;
  stockPrice?: number;         // see DX-REPORT F2: confirm independence before trusting
  lastCashAmount?: number;     // last cash dividend per share, if reported
  dividendYield?: number;
  status?: unknown;
}

export interface AssetStatus { openState: string; marketStatus?: string; reasonCode?: string; reasonMsg?: string; nextOpenTime?: number; nextCloseTime?: number }

export type KlineInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "12h" | "1d";
export type KlineShape = "start+end" | "end" | "start" | "none";
export const KLINE_MAX_LIMIT = 200;
const INTERVAL_MS: Record<KlineInterval, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "12h": 43_200_000, "1d": 86_400_000 };

export interface Kline { openTime: number; open: number; high: number; low: number; close: number; closeTime: number }

/**
 * Issuer from the list API's `type` (observed live 2026-10-08: 1 = Ondo, 2 = xStocks, 3 = bStocks;
 * 4 = pre-IPO tokens such as xOPAI, left unplaced), falling back to symbol conventions:
 * NVDAon (Ondo), NVDAx (xStocks), NVDAB (bStocks).
 */
export function inferIssuer(symbol: string, type?: number): Issuer | "unknown" {
  if (type === 1) return "ondo";
  if (type === 2) return "xstocks";
  if (type === 3) return "bstocks";
  if (type !== undefined) return "unknown";
  if (/on$/.test(symbol)) return "ondo";
  if (/^[A-Z][A-Z0-9.]*x$/.test(symbol)) return "xstocks";
  if (/^[A-Z][A-Z0-9.]*B$/.test(symbol)) return "bstocks";
  return "unknown";
}

export class BinanceRwa {
  constructor(private opts: HttpOptions & { base?: string } = {}) {}

  private async call<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    const url = `${this.opts.base ?? BINANCE_BASE}${path}${qs.size ? `?${qs}` : ""}`;
    const env = await getJson<Envelope<T>>(url, { ...this.opts, headers: { ...BINANCE_HEADERS, ...this.opts.headers } });
    if (env && typeof env === "object" && "code" in env && env.code !== "000000" && env.success === false) {
      throw new BinanceApiError(env.code, env.message, path);
    }
    return (env && typeof env === "object" && "data" in env ? env.data : env) as T;
  }

  async listTokens(type?: number): Promise<ListedToken[]> {
    const data = await this.call<unknown>(PATHS.list, { type });
    const rows: any[] = Array.isArray(data) ? data : Array.isArray((data as any)?.list) ? (data as any).list : [];
    return rows
      .filter((r) => r && r.contractAddress)
      .map((r) => ({
        chainId: String(r.chainId ?? ""),
        contract: String(r.contractAddress).toLowerCase() as `0x${string}`,
        symbol: String(r.symbol ?? ""),
        ticker: String(r.ticker ?? "").toUpperCase(),
        type: num(r.type),
        multiplier: num(r.multiplier),
        issuer: inferIssuer(String(r.symbol ?? ""), num(r.type)),
      }));
  }

  async dynamic(contract: string, chainId = BSC_CHAIN_ID): Promise<DynamicInfo> {
    const d: any = await this.call(PATHS.dynamic, { chainId, contractAddress: contract });
    const t = d?.tokenInfo ?? {}; const s = d?.stockInfo ?? {};
    return {
      symbol: String(d?.symbol ?? ""), ticker: String(d?.ticker ?? "").toUpperCase(),
      tokenPrice: num(t.price), sharesMultiplier: num(t.sharesMultiplier), volume24h: num(t.volume24h), holders: num(t.totalHolders),
      stockPrice: num(s.price), lastCashAmount: num(s.lastCashAmount), dividendYield: num(s.dividendYield), status: d?.statusInfo,
    };
  }

  async marketStatus(): Promise<AssetStatus> {
    const d: any = await this.call(PATHS.marketStatus);
    return { openState: String(d?.openState ?? "UNKNOWN"), reasonCode: d?.reasonCode ?? undefined, reasonMsg: d?.reasonMsg ?? undefined, nextOpenTime: num(d?.nextOpenTime), nextCloseTime: num(d?.nextCloseTime) };
  }

  async assetStatus(contract: string, chainId = BSC_CHAIN_ID): Promise<AssetStatus> {
    const d: any = await this.call(PATHS.assetStatus, { chainId, contractAddress: contract });
    return { openState: String(d?.openState ?? "UNKNOWN"), marketStatus: d?.marketStatus, reasonCode: d?.reasonCode ?? undefined, reasonMsg: d?.reasonMsg ?? undefined, nextOpenTime: num(d?.nextOpenTime), nextCloseTime: num(d?.nextCloseTime) };
  }

  async klines(contract: string, interval: KlineInterval = "15m", limit = KLINE_MAX_LIMIT, window?: { startTime?: number; endTime?: number }, chainId = BSC_CHAIN_ID): Promise<Kline[]> {
    const d: any = await this.call(PATHS.kline, { chainId, contractAddress: contract, interval, limit, startTime: window?.startTime, endTime: window?.endTime });
    const rows: any[] = d?.klineInfos ?? [];
    // closeTime differs by issuer (DX-REPORT F16): Ondo candles end at …59.999, bStocks and xStocks exactly on the
    // boundary. Normalise to openTime + interval − 1 so every series lines up with the same clock.
    return rows.map((k) => ({ openTime: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), closeTime: Number(k[0]) + INTERVAL_MS[interval] - 1 }))
      .filter((k) => Number.isFinite(k.close) && Number.isFinite(k.openTime));
  }

  /** Which request shape the k-line endpoint accepted (see DX-REPORT F14). Discovered once, then reused. */
  klineShape?: KlineShape;

  /**
   * Every candle in [start, end), paged. The endpoint rejected `limit=300` with startTime+endTime as
   * "illegal parameter" (code 000002) on 2026-10-08 while `limit=200` without a window worked, and the
   * docs don't say which part was illegal. So: never ask for more than 200, and try request shapes in
   * order until one is accepted: start+end, end only (page backwards), start only (page forwards),
   * no window (recent candles only, filtered).
   */
  async klinesRange(contract: string, interval: KlineInterval, start: number, end: number, chainId = BSC_CHAIN_ID): Promise<Kline[]> {
    const shapes: KlineShape[] = this.klineShape ? [this.klineShape] : ["start+end", "end", "start", "none"];
    let last: unknown;
    for (const shape of shapes) {
      try {
        const rows = await this.pageKlines(shape, contract, interval, start, end, chainId);
        this.klineShape = shape;
        return rows;
      } catch (e) {
        if (!(e instanceof BinanceApiError && e.code === "000002")) throw e;
        last = e;
      }
    }
    throw last;
  }

  private async pageKlines(shape: KlineShape, contract: string, interval: KlineInterval, start: number, end: number, chainId: string): Promise<Kline[]> {
    const step = INTERVAL_MS[interval], span = step * KLINE_MAX_LIMIT, out = new Map<number, Kline>();
    const keep = (ks: Kline[]) => { for (const k of ks) if (k.openTime >= start && k.openTime < end) out.set(k.openTime, k); };
    if (shape === "none") keep(await this.klines(contract, interval, KLINE_MAX_LIMIT, undefined, chainId));
    else if (shape === "start+end") {
      for (let a = start; a < end; a += span) keep(await this.klines(contract, interval, KLINE_MAX_LIMIT, { startTime: a, endTime: Math.min(end, a + span) - 1 }, chainId));
    } else if (shape === "end") {
      let cursor = end - 1;
      for (let i = 0; i < 40 && cursor >= start; i++) {
        const ks = await this.klines(contract, interval, KLINE_MAX_LIMIT, { endTime: cursor }, chainId);
        keep(ks);
        const first = Math.min(...ks.map((k) => k.openTime));
        if (!ks.length || !(first <= cursor)) break;
        cursor = first - 1;
      }
    } else {
      let cursor = start;
      for (let i = 0; i < 40 && cursor < end; i++) {
        const ks = await this.klines(contract, interval, KLINE_MAX_LIMIT, { startTime: cursor }, chainId);
        keep(ks);
        const lastOpen = Math.max(...ks.map((k) => k.openTime));
        if (!ks.length || !(lastOpen >= cursor)) break;
        cursor = lastOpen + step;
      }
    }
    return [...out.values()].sort((a, b) => a.openTime - b.openTime);
  }

  /** A token quote ready for the model: price per raw token plus its multiplier. */
  async quote(t: ListedToken, onchainMultiplier?: number): Promise<TokenQuote | null> {
    const d = await this.dynamic(t.contract, t.chainId || BSC_CHAIN_ID);
    const multiplier = onchainMultiplier ?? d.sharesMultiplier ?? t.multiplier ?? 1;
    if (!d.tokenPrice || t.issuer === "unknown") return null;
    return {
      issuer: t.issuer, symbol: t.symbol, ticker: t.ticker, contract: t.contract,
      tokenPrice: d.tokenPrice, multiplier, liquidityUsd: d.volume24h, observedAt: Date.now(),
    };
  }
}
