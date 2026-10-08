# Afterhours scorecard (backtest)

Generated 2026-10-08T08:46:27.392Z from real data: Binance token k-lines, Hyperliquid xyz perp candles, official daily bars (Yahoo / Nasdaq).
8 weekends × 10 tickers = 80 forecasts scored. Forecast locked 5 minutes before the Monday open.

| Measure | Value |
|---|---|
| Our mean error vs the official open | 29.6 bps |
| Naive forecast (Friday close) | 99.2 bps |
| Tokens only (no perp signal) | 38.7 bps |
| Error reduction vs naive | 70.1% |
| Direction of gaps ≥ 0.5% called correctly | 98% |
| Scored against official prints / Hyperliquid oracle proxy | 80 / 0 |
| Our error, official prints only | 29.6 bps vs 99.2 naive |
| Token candles loaded | 40692 (15m, request shape "end") |

## Alerts

An alert is worth something only if the token itself moves. "Traded" buys (or sells) the token at the alert price and exits at that token's first traded price after the open; "vs official open" compares the alert price with the stock's opening print, which a token holder can't always realise (a token that keeps its discount after the open shows a paper win). Costs: 0.55% round trip.

| Measure | Traded (realisable) | vs official open (paper) |
|---|---|---|
| Alerts | 278 of 341 (63 had no trade within 6h of the open) | 341 |
| Worth acting on after costs | 60% | 77% |
| Average value after costs | 0.75% | 1.08% |

| Issuer | Alerts | Traded: won after costs | Traded: average after costs | Paper: average after costs |
|---|---|---|---|---|
| xStocks | 66 | 78% of 9 | 1.22% | 0.85% |
| bStocks | 275 | 59% of 269 | 0.74% | 1.14% |

## Token data coverage

| Issuer | Token-weekends | 15m candles per weekend (median) | Basis learned |
|---|---|---|---|
| Ondo | 80 | 288 | 80 of 80 |
| xStocks | 80 | 0 | 0 of 80 |
| bStocks | 80 | 219 | 0 of 80 |

## How much weight the tokens deserve in the forecast

Error vs the official open when fair value blends the perp (weight w) with the token consensus (1 − w), recomputed from this run's inputs. The live default is w = 1.

| w | 0.0 | 0.3 | 0.5 | 0.7 | 0.9 | 1.0 |
|---|---|---|---|---|---|---|
| Error (bps) | 38.7 | 35.2 | 33.2 | 31.4 | 30.1 | 29.6 |

## Issuer basis while the exchange is open

How far each issuer's tokens normally sit from the real stock price (per share, after the multiplier), measured on Friday sessions. Afterhours measures closed-hours moves from this level, not from zero.

| Issuer | Token-weekends | Median | Range |
|---|---|---|---|
| Ondo | 80 | -0.00% | -0.13% to 0.01% |

Approximations: multipliers are today's values for every past weekend. Where official daily bars were unreachable, the Friday close and Monday open come from the Hyperliquid oracle's 15-minute candles (counted separately above); that proxy shares a source with the perp signal, so official-print rows are the stronger evidence.
