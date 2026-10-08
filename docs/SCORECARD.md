# Afterhours scorecard (backtest)

Generated 2026-10-08T08:28:23.702Z from real data: Binance token k-lines, Hyperliquid xyz perp candles, official daily bars (Yahoo / Nasdaq).
8 weekends × 10 tickers = 80 forecasts scored. Forecast locked 5 minutes before the Monday open.

| Measure | Value |
|---|---|
| Our mean error vs the official open | 31.4 bps |
| Naive forecast (Friday close) | 99.2 bps |
| Tokens only (no perp signal) | 38.7 bps |
| Error reduction vs naive | 68.4% |
| Direction of gaps ≥ 0.5% called correctly | 100% |
| Scored against official prints / Hyperliquid oracle proxy | 80 / 0 |
| Our error, official prints only | 31.4 bps vs 99.2 naive |
| Token candles loaded | 37936 (15m, request shape "end") |
| Alerts raised | 316 |
| Alerts worth acting on at the open, after costs | 75% |
| Average alert value at the open, after costs | 1.05% |

## Issuer basis while the exchange is open

How far each issuer's tokens normally sit from the real stock price (per share, after the multiplier), measured on Friday sessions. Afterhours measures closed-hours moves from this level, not from zero.

| Issuer | Token-weekends | Median | Range |
|---|---|---|---|
| Ondo | 80 | -0.00% | -0.13% to 0.01% |

Approximations: multipliers are today's values for every past weekend. Where official daily bars were unreachable, the Friday close and Monday open come from the Hyperliquid oracle's 15-minute candles (counted separately above); that proxy shares a source with the perp signal, so official-print rows are the stronger evidence.
