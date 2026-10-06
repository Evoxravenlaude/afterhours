/** Issuers of tokenized US stocks on BNB Chain. */
export type Issuer = "bstocks" | "ondo" | "xstocks";

/** One tokenized representation of an underlying stock. */
export interface TokenQuote {
  issuer: Issuer;
  symbol: string;            // token symbol, e.g. "bNVDA", "NVDAon"
  ticker: string;            // underlying ticker, e.g. "NVDA"
  contract: `0x${string}`;
  tokenPrice: number;        // USD price of one raw token on chain
  multiplier: number;        // shares of underlying per raw token (1.0 = one share)
  liquidityUsd?: number;     // optional depth proxy for weighting
  observedAt: number;        // unix ms
}

/** An independent price for the underlying that trades while the exchange is closed. */
export interface ExternalSignal {
  source: "hyperliquid" | string;
  ticker: string;
  price: number;             // USD per share
  observedAt: number;
  volume24hUsd?: number;
}

/** Corporate-action and pause state that should silence alerts. */
export interface GuardState {
  ticker: string;
  pendingMultiplier?: { multiplier: number; effectiveAt: number; issuer: Issuer };
  assetStatus?: { issuer: Issuer; openState: string; reasonCode?: string };
}

export interface FairValue {
  ticker: string;
  at: number;
  lastClose: number;
  lastCloseAt: number;
  value: number;             // fair value per share
  low: number;               // band low
  high: number;              // band high
  inputs: {
    tokenConsensus?: number;
    external?: number;
    weights: { external: number; tokens: number };
    sigma: number;           // log-volatility used for the band
    hoursClosed: number;
  };
}

export interface Dislocation {
  ticker: string;
  issuer: Issuer;
  symbol: string;
  contract: `0x${string}`;
  sharePrice: number;        // token price expressed per underlying share
  fairValue: number;
  edgePct: number;           // signed: negative = token cheap vs fair value
  netEdgePct: number;        // after estimated costs
  side: "buy" | "sell";
  at: number;
}
