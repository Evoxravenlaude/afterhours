# Afterhours scorecard (backtest)

Generated 2026-10-08T08:22:35.565Z from real data: Binance token k-lines, Hyperliquid xyz perp candles, official daily bars (Yahoo / Nasdaq).
8 weekends × 0 tickers = 0 forecasts scored. Forecast locked 5 minutes before the Monday open.

| Measure | Value |
|---|---|
| Our mean error vs the official open | 0.0 bps |
| Naive forecast (Friday close) | 0.0 bps |
| Tokens only (no perp signal) | n/a bps |
| Error reduction vs naive | 0.0% |
| Direction of gaps ≥ 0.5% called correctly | 0% |
| Scored against official prints / Hyperliquid oracle proxy | 0 / 0 |
| Our error, official prints only | n/a |
| Token candles loaded | 0 |
| Alerts raised | 0 |
| Alerts worth acting on at the open, after costs | 0% |
| Average alert value at the open, after costs | 0.00% |

## Issuer basis while the exchange is open

How far each issuer's tokens normally sit from the real stock price (per share, after the multiplier), measured on Friday sessions. Afterhours measures closed-hours moves from this level, not from zero.

| Issuer | Token-weekends | Median | Range |
|---|---|---|---|
| n/a | 0 | – | – |

**No token candles loaded: the token and alert layers are not scored in this run; the figures above are the perp signal alone.**

Approximations: multipliers are today's values for every past weekend. Where official daily bars were unreachable, the Friday close and Monday open come from the Hyperliquid oracle's 15-minute candles (counted separately above); that proxy shares a source with the perp signal, so official-print rows are the stronger evidence.
