# Afterhours

**Fair value for tokenized stocks while Wall Street is closed.**

Tokenized US stocks on BNB Chain (bStocks, Ondo, xStocks) trade around the clock. The exchange they track is open about a fifth of the time. For the other four-fifths, token prices drift on thin liquidity and snap back at the open, and the three issuers drift differently, so the same stock trades at three prices on one chain.

Afterhours prices each stock while the exchange is closed, tells you when a token drifts too far from that price, and scores every forecast against the official open, so you can see whether to trust it.

Built for **BNB Hack: Tokenized Stocks Edition**.

## What it does

- **Closed-market fair value.** Hyperliquid's 24/7 xyz stock perpetuals, an independent signal, carried forward from the last official close; the cross-issuer consensus of bStocks, Ondo and xStocks (each converted to a per-share price with its multiplier and a learned per-token basis) stands in only when the perp is stale. The backtest chose this: blending tokens into the forecast made it worse at every weight (see `docs/SCORECARD.md`). The band widens with source disagreement (robust MAD, so one mispriced token can't hide itself) and with signal age.
- **Alerts that mean something.** A token outside the band by more than estimated costs triggers one alert per episode. Telegram delivers it with a ready Binance Agentic Wallet quote command (preview only; nothing is signed).
- **Silence on corporate-action days.** A scheduled multiplier change (BEP-677 `newUIMultiplier` / `effectiveAt`) or a corporate-action pause from Binance's asset status API (`cash_dividend`, `stock_split`, …) silences the ticker. A token about to rebase looks mispriced until it does; alerting then sends people into a trap.
- **A public scorecard.** The forecast is locked 5 minutes before each open and scored against the official opening print, next to the naive forecast ("the price didn't move") and a token-only forecast. If it can't beat "the price didn't move", it shouldn't send alerts.
- **Parity audit.** Every multiplier change is checked against the corporate action that caused it (dividend × (1 − withholding) ÷ reference price, or the split ratio), giving a per-issuer fidelity score.
- **Morning card.** After each open: alerts sent, alerts acted on, the best alert valued by the token's own price after the open, alerts silenced, and the forecast error versus naive. Built to be shared.
- **Agent skill.** `skill/afterhours/SKILL.md` lets any agent ask "is this token cheap right now?" and hand off to `binance-agentic-wallet` for a quote.

## How it uses the Binance stack

| Binance surface | Used for |
|---|---|
| Web3 API, tokenized-securities list | Discover every tokenized stock on BSC and its issuer |
| RWA dynamic | Token price, shares multiplier, volume |
| Asset market status | Corporate-action pause reasons that silence alerts |
| K-lines | History for the backtest and calibration |
| Agentic Wallet (`baw market-order quote`) | One-tap quote from an alert |
| BEP-677 on BSC | On-chain multiplier, pending changes, change history for the audit |

## Run it

```bash
npm install
npm test                         # 64 tests
npx tsx scripts/gate.ts          # live check of every data source; saves raw responses
npx tsx scripts/backtest.ts 8    # score the model on the last 8 weekends -> docs/SCORECARD.md
npm run engine                   # live mode on :8787
MODE=replay npm run engine       # replay the backtest without any API access
```

Environment: see `.env.example`. Telegram is optional; without a token the engine runs the API and web page only.

## Layout

```
packages/core      calendar, fair-value model, guards, scorer, audit, backtest (pure, tested)
packages/sources   Binance Web3 RWA client, Hyperliquid perps, BEP-677 reader, official daily bars
apps/engine        tick loop, SQLite store, Telegram bot, morning card, API + web page
skill/afterhours   agent skill
scripts            gate.ts (live checks), backtest.ts (real-data scorecard)
docs               DX-REPORT.md, SCORECARD.md
```

## Honest state

- The scorecard is only as good as its data: Binance k-lines, Hyperliquid candles and official daily bars (Yahoo, Nasdaq fallback). The backtest uses today's multipliers for past weekends; a dividend inside a window shifts that token by its yield.
- In live mode the forecast is scored against Hyperliquid's oracle two minutes after the open, and each alert against its own token's price at that moment; the backtest uses the official opening print and the token's first trade after the open.
- Costs are estimated (DEX fee plus slippage), not quoted per alert, and the backtest has no historical pool depth: an alert on a thin pool may not fill at the size you want.
- The scorecard values alerts two ways: by the token's own first traded price after the open (what a holder could realise) and against the official open (paper). Only the first counts.
- Not investment advice. Tokenized stocks are not available to US persons.

## Developer experience report

See [`docs/DX-REPORT.md`](docs/DX-REPORT.md), written as we built.
