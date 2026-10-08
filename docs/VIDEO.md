# Demo video script (target 3:40, limit 4:00)

Record on Saturday Oct 10, while the market is closed, so the live alerts and fair values are real. Screen recording plus voiceover; no slides beyond the first and last frame.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:20 | The web page at the Railway URL, fair-value list scrolling | "Tokenized US stocks on BNB Chain trade 24/7. The exchange they track is open about a fifth of the week. For the rest, nobody tells you what the stock is actually worth. Afterhours does." |
| 0:20–0:50 | `/api/fair-values` for NVDA, then the same stock's three tokens (bStocks, Ondo, xStocks) with their prices | "The same stock trades at three prices on one chain. Afterhours prices it from Hyperliquid's 24/7 stock perps, an independent signal, and converts each issuer's token to a per-share price with its multiplier and its normal gap to the stock. AMD's bStocks token, for example, sits about 2.9% under the stock every day; without learning that, you'd call it a bargain." |
| 0:50–1:30 | `docs/SCORECARD.md`: forecast table, then the alert table with the Traded column | "Does it work? We backtested eight weekends on official opening prints. Forecasting Monday's open: 29.6 basis points of error against 99 for 'Friday's close'. Alerts: we didn't value them against the stock, because a token can keep its discount after the open. We valued them by trading the token itself. 68% paid after costs, plus 1.19% on average, positive in all eight weekends." |
| 1:30–2:15 | Telegram: an alert arriving, then the Quote button revealing the `baw market-order quote` command; "I took it" / "Skip" | "Live, it runs on Railway and talks to you on Telegram. An alert names the token, the edge after costs, and the full contract. One tap gives you the Binance Agentic Wallet quote command for that exact token. Nothing is signed; you decide." |
| 2:15–2:45 | A silenced alert in the web page's alert table (reason shown), then the Ondo 24/5 note | "It also knows when to stay quiet: a pending dividend or split from the asset status API or the BEP-677 multiplier schedule, an Ondo token during its weekend close, or a token whose normal gap it hasn't learned yet." |
| 2:45–3:15 | Morning card PNG (`/card/latest.png`), then `/score` in Telegram | "After every open, a morning card: alerts sent, what the best one actually paid, what was silenced, and the forecast error against naive. The scorecard is public, so you can check whether to trust it." |
| 3:15–3:40 | `skill/afterhours/SKILL.md`, then `docs/DX-REPORT.md` section headings | "Any agent can use it through the skill and hand off to the Agentic Wallet for quotes. And the developer report lists the sixteen things we hit building on the Web3 API, with what we'd change. Afterhours: fair value for tokenized stocks while Wall Street sleeps." |

Notes
- Show real numbers only. If Saturday has no live alert, show a silenced one and a backtest alert from `/api/alerts` in replay mode (`MODE=replay npm run engine`), and say it's from the backtest.
- Keep the Railway URL visible in the browser bar once, so judges can find it.
