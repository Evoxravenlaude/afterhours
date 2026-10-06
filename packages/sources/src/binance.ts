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

export interface Kline { openTime: number; open: number; high: number; low: number; close: number; closeTime: number }

/** Best-effort issuer from the API's `type` and the token symbol conventions (NVDAon, bNVDA, NVDAx). */
export function inferIssuer(symbol: string, type?: number): Issuer | "unknown" {
  if (type === 1) return "ondo";
  if (/on$/i.test(symbol)) return "ondo";
  if (/^b[A-Z]/.test(symbol)) return "bstocks";
  if (/x$/.test(symbol)) return "xstocks";
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

  async klines(contract: string, interval: "1m" | "5m" | "15m" | "1h" | "4h" | "12h" | "1d" = "15m", limit = 300, window?: { startTime: number; endTime: number }, chainId = BSC_CHAIN_ID): Promise<Kline[]> {
    const d: any = await this.call(PATHS.kline, { chainId, contractAddress: contract, interval, limit, startTime: window?.startTime, endTime: window?.endTime });
    const rows: any[] = d?.klineInfos ?? [];
    return rows.map((k) => ({ openTime: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), closeTime: Number(k[6]) }))
      .filter((k) => Number.isFinite(k.close));
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
