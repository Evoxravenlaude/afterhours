# Developer Experience Report: Binance Web3 API, Tokenized Securities, Agentic Wallet

Built while making Afterhours (BNB Hack: Tokenized Stocks Edition), Oct 6–10, 2026. Dated log of every problem at the end (F1–F17); the seven sections below sort them.

## Summary

Backtest: 70% less error than the naive forecast of the Monday open, alerts paid on the token's own price in 8 of 8 weekends. Live: the forecast won both opens; the first night's alerts lost, because the API serves prices nobody is trading at (F17). About a day went on things the docs don't say. Five changes would have saved most of it:

1. **Say which issuer each row is.** bStocks are `type=3` with a `B` suffix; nothing documents it, and the published symbol examples point the other way (F1, F10).
2. **Publish the real response schemas.** `openState`, `reasonCode`, `marketStatus` and the `offhours` block all differ from the skill docs (F8, F11).
3. **Name the field in "illegal parameter".** A k-line window request failed for every token with no hint why; our first backtest silently ran without token data (F14).
4. **One convention per field across issuers.** `closeTime`, `stockInfo.price` and the multiplier each behave differently for bStocks, Ondo and xStocks, and two of those differences failed silently (F2, F13, F15, F16).
5. **Expose the underlying's last official close.** `stockInfo.price` / `referencePrice` is derived from the token for some issuers, which other builders have already mistaken for an independent price (F2).

## 1. Onboarding

- No API key is needed and the endpoints answered from GitHub Codespaces on the first call. That part was quick.
- The primary documentation is a set of agent skill pages, not an API reference. Coverage claims disagree between the announcement and the skill (F1), and the unusual required headers (`Accept-Encoding: identity`, `binance-web3/1.1 (Skill)`) aren't explained (F3).
- There are no example responses or test fixtures, so the first working code came from saving raw live responses and reading them (our `scripts/gate.ts`), not from the docs.

## 2. Documentation issues

- The `type` enum isn't documented; issuers were found by trial: 1 Ondo, 2 xStocks, 3 bStocks, 4 pre-IPO, 5 another chain (F1, F10).
- Status fields as documented don't match live responses (F8, F11); market-status times looked inverted during the overnight session (F9).
- Three multiplier fields (`sharesMultiplier`, list `multiplier`, on-chain `uiMultiplier()`) with no statement of source, precision or timing (F4).
- Corporate-action reason codes (`cash_dividend`, `stock_split`…) are exactly what integrators need and live only in a skill page (F5).

## 3. API pitfalls

- `code=000002 "illegal parameter"` with no field named, for a k-line window request (`limit=300` with `startTime`/`endTime`); `limit=200` paging backwards with `endTime` works (F14).
- K-lines skip intervals with no quote; a series is not one candle per interval (F12).
- `closeTime` is `openTime + interval − 1` for Ondo and `openTime + interval` for bStocks and xStocks. Matching by end time failed for 160 of 240 token-weekends without an error (F16).
- `stockInfo.price` is derived from the token for Ondo, differs for xStocks and is null for bStocks (F2, F13).

## 4. AI stack feedback (Agentic Wallet, Wallet Skills)

- The market-order flags live only in a nested reference file. GitHub's tree view is blocked to automated fetchers, so an agent can't list the reference files; we guessed the flags first and got them wrong (F6).
- An agent that trusts the skill docs will misread live status responses (F8, F11) and, per two public hackathon repos, may treat a derived price as an independent one (F2). Skills are only as safe as the schema they describe.
- `--fromTokenQty` sizes in token units; for a tokenized stock that means knowing the multiplier, which an agent can easily get wrong (F7).
- Afterhours generates `baw market-order quote` commands (Telegram Quote button, agent skill). No swap was executed against a funded wallet during the build.

## 5. Tokenized-stock specifics

- **Three issuers, three prices, three behaviours.** The same stock trades at different per-share prices on one chain. AMD's bStocks token sat about 2.9% under the stock during Friday sessions; most tokens sit within 0.1%.
- **Ondo trades 24/5.** Its k-lines stop Friday 8pm and resume Sunday 8pm New York time, so a weekend Ondo price is a frozen Friday-evening price (F12).
- **Only bStocks implement BEP-677 on BSC.** `uiMultiplier()` reverts on Ondo and xStocks (F15), so for two of three issuers the multiplier exists only in API fields.
- **xStocks barely trade on BSC.** Median 0 fifteen-minute candles per weekend in our sample.
- **xStocks quotes on BSC can sit unchanged for hours.** On our first live night every one of 61 alerts was an xStocks token, and 52 of them had moved less than 0.1% by the next open. A price from the API looks live whether or not anyone is trading at it; nothing in the response says when it last changed (F17).
- **The weekend gap is real and forecastable.** Hyperliquid's 24/7 stock perps forecast the Monday open with 29.6 bps mean error against 99.2 for "Friday's close" (80 opens). The tokens alone managed 31.4 bps once each token's normal gap to the stock was learned.

## 6. Redesign suggestions

- One token schema across issuers: `issuer`, `multiplierSource` (on-chain or API), `tradingWindow`, and `underlying.lastClose` with its timestamp.
- One clock convention for every k-line series, and documented window rules (limit cap, allowed span, intervals).
- Error envelopes that name the offending field in `messageDetail`.
- An API reference generated from the live schema, with the skills linking to it, rather than skills as the primary docs.

## 7. Requested capabilities

1. The underlying's last official close and its time, as its own field.
2. A forward corporate-action calendar per token (ex-date, amount, expected multiplier change), not just a pause reason on the day.
3. Each issuer's trading window in the asset status response.
4. Quote at size for tokenized stocks through the Web3 API (pool depth), so a monitor can check whether an alert would fill without driving the CLI.
5. A last-trade or last-update timestamp on every RWA dynamic price (F17).
6. Historical multipliers per token, so a backtest can use the multiplier that applied on the day.
7. A streaming endpoint for RWA dynamic prices.

## Appendix: friction log (dated, as it happened)

### 2026-10-06: Reading the docs

**F1. Coverage claims disagree between sources.**
The hackathon announcement says the Web3 API aggregates bStocks, Ondo and xStocks. The `binance-tokenized-securities-info` skill page says Ondo Finance is "currently the only supported tokenized stock provider", and its token list endpoint documents only `type=1` (Ondo). A builder can't tell from the docs which issuers the RWA endpoints actually return.
_Suggestion:_ document every `type` value in one table on the API reference, and state coverage per endpoint.

**F2. `referencePrice` reads like an independent reference, but other builders report it is derived from the token price.**
Two public hackathon repos (Weekend Gap Tracker, Closing Bell Agent) document that treating it as the underlying's price produced false spreads in the hundreds of percent. The field name invites exactly that mistake.
_Suggestion:_ rename it or document its derivation next to the field, and expose the last official close of the underlying as its own field with a timestamp.

**F3. Unusual required headers.**
The RWA endpoints document `Accept-Encoding: identity` and a `binance-web3/1.1 (Skill)` user agent. Neither is common, and neither appears in the general Web3 API overview.
_Suggestion:_ say why (compression issue? skill attribution?) and whether non-skill clients should send them.

**F4. Multiplier data lives in three places.**
`sharesMultiplier` (RWA dynamic API), `multiplier` (token list API), and `uiMultiplier()` on chain (BEP-677). The docs don't say whether they're the same number, at the same precision, updated at the same moment.
_Suggestion:_ one sentence per field: source, precision, update timing, and how it relates to BEP-677.

**F5. Corporate-action reason codes are a good idea, hidden in a skill page.**
`cash_dividend`, `stock_split`, `merger` and others appear as pause reasons in the asset market status API. That is exactly what an integrator needs to avoid trading into a rebase, and it's only documented inside the skill.
_Suggestion:_ promote these to the main API reference with examples.

**F6. Agentic Wallet flags are only in a nested reference file.**
The skill's SKILL.md tells agents to "always read reference files first", but the market-order syntax (`--fromTokenQty --fromToken --toToken --binanceChainId`) lives only in `references/market-order.md`, and GitHub's tree view of the skill folder is blocked to automated fetchers by robots.txt, so an agent can't list the reference files to find it. We guessed the flags first and got them wrong.
_Suggestion:_ put one complete quote example and one swap example in SKILL.md itself, and link each reference file by full raw URL.

**F7. Quotes are sized in the from-token, never in USD.**
`--fromTokenQty` is a token quantity. For a sell of a tokenized stock, the integrator must convert a dollar amount into raw token units, which means knowing the multiplier. A `--fromUsd` option, or a documented example with a tokenized stock, would remove a common sizing mistake.

### 2026-10-08: First live run (gate script, GitHub Codespaces)

**F1 (confirmed). Issuer coverage is discoverable only by trial.**
`type=1` returned 1,366 Ondo tokens and `type=2` returned 269 xStocks across all chains; `type=3/4/5` returned 91, 4 and 194 tokens whose symbols follow neither convention; `type=0` returned nothing. 588 tokens are on BSC. None matched the bStocks symbol convention, so either bStocks aren't in this endpoint or they use a symbol pattern the docs don't describe.
_Suggestion:_ an `issuer` field on every row, and a documented enum for `type`.

**F2 (confirmed). `stockInfo.price` is derived from the token for Ondo.**
For EEMon, `tokenPrice / sharesMultiplier / stockInfo.price` was exactly 1.00000. For AAPLx (xStocks) the same ratio was 0.98435, so the field is not consistent across issuers either. An integrator can't tell which case they're in.
_Suggestion:_ document the source of `stockInfo.price` per issuer, or expose the independent last official close as a separate field.

**F8. Status values differ from the skill docs.**
Docs list `TRADING`, `MARKET_CLOSED`, `ASSET_PAUSED`… as states. Live responses return `openState` as the string `"true"`/`"false"`, put `TRADING` in `reasonCode`, and add a `marketStatus` of `"overnight"` that isn't documented. Our first guard treated the documented states as `openState` values and would have missed pauses.
_Suggestion:_ publish the real response schema with examples for regular, overnight, closed, paused and corporate-action cases.

**F9. Market status times look inverted.**
The market status endpoint returned `nextOpenTime` 1791446460000 and `nextCloseTime` 1791446100000 (close six minutes before open) during the overnight session. Possibly the gap between overnight and pre-market sessions, but undocumented.

### 2026-10-08: Reading the live fixtures

**F10. bStocks are type 3 with a `B` suffix, and nothing says so.**
NVDAB, TSLAB, AAPLB… 91 BSC tokens under `type=3`. A builder following the published symbol examples looks for a `b` prefix and finds no bStocks at all; we did. `MUB` (bStocks Micron) also collides with a well-known bond ETF ticker, so the `ticker` field, not the symbol, has to be the join key.
_Suggestion:_ document the `type` enum (1 Ondo, 2 xStocks, 3 bStocks, 4 pre-IPO…) and add an `issuer` string to each row.

**F11. `openState` is a JSON boolean in live responses, and there's an undocumented `offhours` block.**
Market status returned `"openState": true`, `"marketStatus": "overnight"`, `"reasonCode": null`, plus `"offhours": { "openState": false, "nextOpenTime": …, "nextCloseTime": … }`. None of that shape is in the skill docs, which describe string states.

**F12. K-lines omit intervals with no quote, and Ondo tokens stop for the weekend.**
EEMon's 1h k-lines end with the candle that closes at Saturday 00:00 UTC and resume Monday 00:00 UTC, on both weekends in the response (2026-09-25 and 2026-10-02): Friday 8pm to Sunday 8pm New York time, Ondo Global Markets' 24/5 schedule. Neither the gap behaviour nor the per-issuer hours are documented. An integrator who assumes one candle per interval will misalign series, and one who reads the weekend price as live will flag a frozen Friday-evening price as a weekend dislocation. We now separate "fresh" quotes (which shape fair value) from "held" prices, and never alert on an Ondo token during its closed window.
_Suggestion:_ state the gap behaviour (or add `fill=previous`), and expose each issuer's trading window in the asset status response.

**F13. `stockInfo.price` is null for bStocks.**
MUB returned `"price": null` in `stockInfo` while xStocks and Ondo returned numbers. Three issuers, three behaviours for the same field.

### 2026-10-08: First backtest run

**F14. K-lines with a time window fail with "illegal parameter", and the error doesn't say which one.**
`kline/ai?interval=15m&limit=300&startTime=…&endTime=…` returned `code=000002 "illegal parameter"` for every token, while `interval=1h&limit=200` without a window worked in the same session. Any of four things could be the cause (limit above a cap, the window, its span, or the interval), and the response names none of them. Our first backtest therefore scored the perp signal alone, without our noticing until we read the log.
We now never ask for more than 200 candles and try request shapes in order (start+end in 200-candle chunks, then endTime only paging backwards, then startTime only, then no window), keep the first one accepted, and print it in the scorecard.
_Suggestion:_ name the offending field in `messageDetail` and document the limit cap, the window rules and the supported intervals.

**F15. Only bStocks implement BEP-677 on BSC.**
`uiMultiplier()` returns a value on bStocks (MUB 1.000107…, NVDAB 1.000778…, CRCLB exactly 1) and reverts on every Ondo and xStocks token we probed, though Ondo tokens answer ERC-165. So "BEP-677 multiplier" means bStocks only; for the other issuers the multiplier exists only in Binance's API fields, which F4 already found ambiguous.
_Suggestion:_ say per issuer which multiplier source is authoritative.

**F16. K-line `closeTime` follows a different convention per issuer.**
Ondo candles close at `openTime + interval − 1` (…59.999), bStocks and xStocks candles at `openTime + interval` exactly. Matching token candles to official 15-minute bars by end time silently failed for every bStocks and xStocks token: our per-token basis was learned for 80 of 80 Ondo token-weekends and 0 of 160 others, and nothing errored. We now derive the close from `openTime` and the interval and ignore the field.
_Suggestion:_ one convention for every series, stated in the docs.

### 2026-10-09: First live night

**F17. A dynamic price doesn't say how old it is.**
Every one of 61 overnight alerts was an xStocks token that looked 1–3% under fair value. Valued against the stock's opening print they averaged +1.0% after costs; valued on the tokens themselves they averaged −0.27%, because 52 of the 61 had moved less than 0.1% by the open. The RWA dynamic response gives `tokenPrice` with no last-trade or last-update time, so a quote nobody is trading at looks the same as a live one. We now track when each token's price last changed and ignore tokens unchanged for three hours.
_Suggestion:_ add `lastTradeTime` (or `priceUpdatedAt`) and 24h trade count to the dynamic response.

