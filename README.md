# Afterhours

**Fair value for tokenized stocks while Wall Street is closed.**

Tokenized US stocks on BNB Chain (bStocks, Ondo, xStocks) trade around the clock. The exchange they track is open about a fifth of the time. For the other four-fifths, token prices drift on thin liquidity and snap back at the open, and the three issuers drift differently, so the same stock trades at three prices on one chain.

Afterhours prices each stock while the exchange is closed, tells you when a token drifts too far from that price, and scores every forecast against the official open, so you can see whether to trust it.

Built for **BNB Hack: Tokenized Stocks Edition**. Live at **https://afterhours-production-f753.up.railway.app** and on Telegram (@AfterhourszaBot).

## Results

Backtest on real data: the last 8 weekends (Aug 14 to Oct 5, 2026) for the 10 stocks with a liquid 24/7 perp and BSC tokens (AAPL, AMD, AMZN, COIN, GOOGL, META, MSFT, NVDA, PLTR, TSLA), scored against official opening prints. Full table: [`docs/SCORECARD.md`](docs/SCORECARD.md).

| | Afterhours | Naive ("Friday's close") |
|---|---|---|
| Mean error forecasting the Monday open | **29.6 bps** | 99.2 bps |
| Direction of gaps of 0.5% or more | **98%** | n/a |

| Alerts, valued by trading the token itself | |
|---|---|
| Alerts with a trade after the open | 193 of 259 |
| Worth acting on after 0.55% costs | **68%** |
| Average after costs | **+1.19%** |
| Weekends with a positive average | **8 of 8** |

### Live, from 2026-10-08

| Night | Forecast error at the open | Alerts | Paid after costs (token price) | Average after costs (token price) | vs official open (paper) |
|---|---|---|---|---|---|
| Wed → Thu open | 48 bps vs 83 naive | 0 (engine still learning) | – | – | – |
| Thu → Fri open | 62 bps vs 119 naive | 61, all xStocks | 9 of 61 | **−0.27%** | +1.01% |

The first live night lost money. All 61 alerts were xStocks tokens whose quoted price barely changed: 52 had moved less than 0.1% by the open. The backtest never saw this, because it only valued tokens that traded. Since 2026-10-09 Afterhours ignores any token whose price hasn't changed for three hours, and values each alert at the token's first price change after the open (or its price six hours after the open if it never moves), the same rule as the backtest. The forecast held up on both nights.

Read the backtest with care: AMD supplies a third of the alerts (without it, 67% and +0.88%); COIN is the weak spot (43%); there is no historical pool depth, so fills at size aren't proven; the 0.5% minimum edge was chosen on this same data, so live weekends from 2026-10-09 are the real test.

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
npm test                         # 72 tests
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
docs               DX-REPORT.md, SCORECARD.md, VIDEO.md (script), SUBMISSION.md (form draft)
```

## Honest state

- The scorecard is only as good as its data: Binance k-lines, Hyperliquid candles and official daily bars (Yahoo, Nasdaq fallback). The backtest uses today's multipliers for past weekends; a dividend inside a window shifts that token by its yield.
- In live mode the forecast is scored against Hyperliquid's oracle two minutes after the open, and each alert against its own token's price at that moment; the backtest uses the official opening print and the token's first trade after the open.
- Costs are estimated (DEX fee plus slippage), not quoted per alert, and the backtest has no historical pool depth: an alert on a thin pool may not fill at the size you want.
- The scorecard values alerts two ways: by the token's own first traded price after the open (what a holder could realise) and against the official open (paper). Only the first counts.
- Not investment advice. Tokenized stocks are not available to US persons.

## Developer experience report

See [`docs/DX-REPORT.md`](docs/DX-REPORT.md), written as we built.
