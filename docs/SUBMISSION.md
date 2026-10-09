# Submission form draft (BNB Hack: Tokenized Stocks Edition)

Fields marked EDIT need your input. Submit by Saturday Oct 10; the form locks Sunday Oct 11, 12:00 UTC.

**Project name:** Afterhours

**One line:** Fair value for tokenized US stocks on BNB Chain while Wall Street is closed, with alerts scored by what trading the token actually paid.

**Description:**
Tokenized US stocks on BNB Chain trade 24/7, but the exchange they track is open about a fifth of the week. For the rest, token prices drift on thin liquidity and the three issuers (bStocks, Ondo, xStocks) drift differently, so the same stock trades at three prices on one chain. Afterhours prices each stock while the exchange is closed, using Hyperliquid's 24/7 stock perps as an independent signal and converting every issuer's token to a per-share price with its multiplier and its learned normal gap to the stock. It alerts on Telegram when a token is off by more than costs, with a ready Binance Agentic Wallet quote command, and stays silent around dividends, splits, pauses and issuer closures. Every forecast is scored at the open. Backtest over 8 weekends on official prints: 29.6 bps error forecasting the Monday open against 99.2 for the naive forecast; 68% of alerts paid after costs when valued on the token's own price (+1.19% average, positive in all 8 weekends).

**Public repository:** https://github.com/Evoxravenlaude/afterhours

**Deployed link:** https://afterhours-production-f753.up.railway.app

**How a judge can try it:**
1. Open the deployed link: live fair values, alerts and the scorecard.
2. Telegram: message [EDIT: @your_bot_username] `/start`, then `/now` and `/score`.
3. Locally without any API access: `npm install && MODE=replay npm run engine`, then open http://localhost:8787 (replays the real-data backtest).
4. Re-run the evidence: `npm test` (69 tests) and `TICKERS=AAPL,AMD,AMZN,COIN,GOOGL,META,MSFT,NVDA,PLTR,TSLA npx tsx scripts/backtest.ts 8`.

**Binance Web3 API modules used:** tokenized-securities list (all BSC tokens and issuers), RWA dynamic (price, multiplier, volume), market status and asset market status (corporate-action pauses), token k-lines (backtest and basis learning); Agentic Wallet `baw market-order quote` commands from every alert and in the agent skill; BEP-677 `uiMultiplier` / `newUIMultiplier` on BSC.

**Developer Experience Report:** https://github.com/Evoxravenlaude/afterhours/blob/main/docs/DX-REPORT.md

**Demo video:** [EDIT: link, under 4 minutes]

**Special prizes:** Best Use of Agentic Wallet / Wallet Skills. Afterhours ships an agent skill (`skill/afterhours/SKILL.md`) that answers "is this token cheap right now?" from live fair value and hands off to `binance-agentic-wallet` with the exact quote command. [EDIT: only claim execution if you have run `baw` yourself.]

**Team:** Solo. [EDIT: name/handle, contact]

**Eligibility:** [EDIT: confirm you are not located in, resident of or a citizen of a restricted jurisdiction.]
