# Submission form draft (BNB Hack: Tokenized Stocks Edition)

Form locks Sunday Oct 11, 12:00 UTC. Only the video link is still blank.

**Project name:** Afterhours

**One line:** Fair value for tokenized US stocks on BNB Chain while Wall Street is closed, with alerts scored by what trading the token actually paid.

**Description:**
Tokenized US stocks on BNB Chain trade 24/7, but the exchange they track is open about a fifth of the week. For the rest, token prices drift on thin liquidity and the three issuers (bStocks, Ondo, xStocks) drift differently, so the same stock trades at three prices on one chain. Afterhours prices each stock while the exchange is closed, using Hyperliquid's 24/7 stock perps as an independent signal and converting every issuer's token to a per-share price with its multiplier and its learned normal gap to the stock. It alerts on Telegram when a token is off by more than costs, with a ready Binance Agentic Wallet quote command, and stays silent around dividends, splits, pauses and issuer closures. Every forecast is scored at the open. Backtest over 8 weekends on official prints: 29.6 bps error forecasting the Monday open against 99.2 for the naive forecast; 68% of alerts paid after costs when valued on the token's own price (+1.19% average, positive in all 8 weekends). Live since Oct 8, the forecast beat the naive one on both opens (48 vs 83 bps, 62 vs 119). The first live night's alerts lost 0.27% on average because the API quoted xStocks prices nobody was trading at; Afterhours now ignores tokens whose price hasn't changed for three hours, and we report that night as it happened.

**Public repository:** https://github.com/Evoxravenlaude/afterhours

**Deployed link:** https://afterhours-production-f753.up.railway.app

**How a judge can try it:**
1. Open the deployed link: live fair values, alerts and the scorecard.
2. Telegram: message @AfterhourszaBot `/start`, then `/now`, `/score` and `/health`.
3. Locally without any API access: `npm install && MODE=replay npm run engine`, then open http://localhost:8787 (replays the real-data backtest).
4. Re-run the evidence: `npm test` (72 tests) and `TICKERS=AAPL,AMD,AMZN,COIN,GOOGL,META,MSFT,NVDA,PLTR,TSLA npx tsx scripts/backtest.ts 8`.

**Binance Web3 API modules used:** tokenized-securities list (all BSC tokens and issuers), RWA dynamic (price, multiplier, volume), market status and asset market status (corporate-action pauses), token k-lines (backtest and basis learning); Agentic Wallet `baw market-order quote` commands from every alert and in the agent skill; BEP-677 `uiMultiplier` / `newUIMultiplier` on BSC.

**Developer Experience Report:** https://github.com/Evoxravenlaude/afterhours/blob/main/docs/DX-REPORT.md

**Demo video:** (add the link; under 4 minutes)

**Special prizes:** Best Use of Agentic Wallet / Wallet Skills. Afterhours ships an agent skill (`skill/afterhours/SKILL.md`) that answers "is this token cheap right now?" from live fair value and hands off to `binance-agentic-wallet` with the exact quote command; every Telegram alert carries the same command behind its Quote button. Afterhours generates the commands; it does not sign or execute anything, and no swap was executed during the build.

**Team:** Solo. Rav3n: GitHub Evoxravenlaude, X @rv3nlaud3, Telegram @rav3nlaud.

**Eligibility:** Confirmed. Based in Gabon; not located in, resident of or a citizen of any restricted jurisdiction, and not subject to sanctions.
