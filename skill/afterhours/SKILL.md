---
name: afterhours
description: Fair value for tokenized US stocks on BNB Chain (bStocks, Ondo, xStocks) while the US exchange is closed. Use before any weekend or overnight trade of a tokenized stock, to check whether the token is cheap or rich against fair value, whether a dividend or split is about to change its multiplier, and how accurate the model has been at past opens. Pairs with binance-agentic-wallet for quotes.
---

# Afterhours

Tokenized stocks trade 24/7 on BNB Chain; the underlying exchange is open about a fifth of the time. While it's closed, token prices drift on thin liquidity and snap back at the open. Afterhours estimates fair value per share from:

1. the last official close,
2. Hyperliquid's xyz stock perpetuals (24/7, independent of the tokens),
3. the bStocks, Ondo and xStocks tokens for the same stock, converted to per-share prices with each token's multiplier (BEP-677 `uiMultiplier`).

It publishes a band around fair value, flags tokens outside it by more than estimated costs, and silences anything near a scheduled multiplier change or a corporate-action pause.

## When to use

- Before buying or selling a tokenized stock while the US market is closed (nights, weekends, holidays).
- When asked "is NVDA on BNB Chain cheap right now?", "which version of TSLA should I buy?", or "is anything mispriced this weekend?"
- When a user wants to know whether a dividend or split is about to change a token's balance.

## Endpoints

Base URL: the deployed engine (e.g. `https://afterhours-production.up.railway.app`). All GET, JSON, no auth.

| Endpoint | Returns |
|---|---|
| `/api/status` | `open`, `lastClose`, `nextOpen` (ms), `mode` |
| `/api/fair-values` | Latest fair value per ticker: `value`, `low`, `high`, `inputs.external` (perp), `inputs.tokenConsensus`, `inputs.weights`, `inputs.hoursClosed` |
| `/api/alerts?limit=50` | Recent dislocations: `ticker`, `issuer`, `contract`, `side` (`buy` = token cheap), `edgePct`, `netEdgePct`, `suppressed` (reason, if silenced), `worthPct` (value at the open, once settled) |
| `/api/score` | Forecast accuracy at past opens: `n`, `maeBps`, `naiveMaeBps`, `improvementPct`, `directionHitRate` |

## How to answer

1. Call `/api/status`. If `open` is true, say the exchange is open and the token should track the live price; Afterhours is for closed hours.
2. Call `/api/fair-values`, find the ticker, and compare the token's per-share price to the band. Say which issuer is cheapest relative to fair value.
3. Call `/api/alerts` and check `suppressed` for that ticker. If a multiplier change or corporate action is pending, tell the user plainly and do not suggest a trade.
4. Quote the scorecard from `/api/score` so the user knows how reliable fair value has been.
5. For a quote, hand off to the `binance-agentic-wallet` skill with the full contract address:
   `baw market-order quote --fromTokenQty <USDT amount> --fromToken 0x55d398326f99059fF775485246999027B3197955 --toToken <token contract> --binanceChainId 56 --json`
   Confirm with the user before any swap. Never execute on an alert alone.

## Rules

- Show full contract addresses, never truncated.
- Fair value is a model. Always pair it with the scorecard.
- If the alert is silenced, don't trade it, whatever the edge.
- Not investment advice. Tokenized stocks are not available to US persons.
