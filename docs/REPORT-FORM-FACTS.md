# Report form: facts per question

Fact sheet for the Developer Experience Report form (8 pages). Multiple-choice picks are marked; free-text questions get the facts, numbers and F-numbers to write from. Items marked "you" depend on your own experience and nobody else can answer them. Write the free-text answers yourself.

## 1. Submission details

- Team or project name: Afterhours
- Public repository URL: https://github.com/Evoxravenlaude/afterhours
- Modules used (tick): RWA Data API (token list, dynamic, market status, asset market status), Market API (dex token k-lines), Agentic Wallet / Wallet Skills (read the skill docs, generated `baw market-order quote` commands; nothing executed). Nothing else. BEP-677 reads went to a public BSC RPC, not a Binance module.
- Team size: Solo
- Web3 experience, prior Binance Web3 API use: you

## 2. Onboarding

- Time to first successful call: you. For reference, the first full gate run (`scripts/gate.ts`) was Oct 8 and saved live responses to `packages/sources/test/fixtures/live/`.
- API key: none needed; every endpoint used is public and unauthenticated. Pick the shortest option and say so in the text.
- Rating: you
- Where stuck (page, step, what you tried):
  - F1: announcement says Web3 API covers bStocks, Ondo, xStocks; the `binance-tokenized-securities-info` skill says Ondo is the only supported provider and documents only `type=1`. Found the rest by calling `type=2,3,4,5`.
  - F3: required headers `Accept-Encoding: identity` and `User-Agent: binance-web3/1.1 (Skill)` are listed without saying why.
  - F10: bStocks are `type=3`, symbols end in `B` (NVDAB, MUB). Docs' symbol examples suggested a `b` prefix; first pass found zero bStocks.
  - F6: `baw market-order quote` flags (`--fromTokenQty --fromToken --toToken --binanceChainId`) live only in `references/market-order.md`; SKILL.md says "read reference files first" but doesn't list them, and GitHub's tree view is blocked to automated fetchers. Guessed the flags first and got them wrong.
- Step that took longer: discovering issuer coverage and the `type` enum by trial (F1, F10); or reading live responses to learn the real status schema (F8, F11). Your pick.
- llms.txt: you (if you never saw them: "No, I did not know they existed").
- AI agent errors against the docs: wrong `baw` flags (F6); status guard built on the documented string states `TRADING`/`MARKET_CLOSED`/`ASSET_PAUSED`, but live `openState` is a boolean and the state is in `reasonCode` (F8, F11).

## 3. Documentation issues

- Rating: you
- Errors, one per line (page URL, section, wrong, should say). Paste the URLs from your history; the skill pages were the source for all of these:
  - tokenized-securities skill, token list: says Ondo only, `type=1` only. Live: 1 Ondo, 2 xStocks, 3 bStocks, 4 pre-IPO (xOPAI, xKLSH, xSPCX), 5 another chain, 9 misc (F1, F10).
  - tokenized-securities skill, market status: documents string states. Live: `"openState": true/false`, `"marketStatus": "overnight"`, `"reasonCode": "TRADING"`, plus an undocumented `offhours` block (F8, F11).
  - tokenized-securities skill, dynamic: `stockInfo.price` reads as the underlying's price. Live: equals tokenPrice/sharesMultiplier exactly for Ondo (ratio 1.00000), ratio 0.98435 for AAPLx, `null` for bStocks (F2, F13).
  - agentic wallet skill, SKILL.md: no quote/swap example; flags only in `references/market-order.md` (F6).
  - k-line endpoint: `closeTime` is `openTime + interval − 1` for Ondo and `openTime + interval` for bStocks/xStocks; nothing says so (F16).
- Missing or under-documented: the `type` enum and an `issuer` field; real response schemas with examples; k-line window rules (limit cap, span, intervals); which of three multiplier fields is authoritative per issuer (F4, F15); per-issuer trading windows, Ondo is 24/5 (F12); corporate-action codes exist only in the skill (F5); no last-trade time on prices (F17).
- Examples runnable: you.
- Most useful page: you (likely the tokenized-securities skill page, since it had the endpoint paths and the reason codes).

## 4. API pitfalls

- Reliability rating: you. Facts: engine ran 55–65 stocks per minute on Railway from Oct 8, about 130 calls a minute at concurrency 6, zero `tick failed` lines in three days of logs.
- Edge cases (endpoint, request, result):
  - `dex/market/token/kline/ai`: skips intervals with no quote, so series aren't one candle per interval; Ondo series stop Fri 20:00 to Sun 20:00 ET (F12).
  - `kline/ai`: `closeTime` convention differs by issuer; matching by end time silently failed for 160 of 240 token-weekends (F16).
  - `rwa/market/status/ai` during overnight: `nextOpenTime` 1791446460000, `nextCloseTime` 1791446100000, close before open (F9).
  - `rwa/dynamic/ai`: `stockInfo.price` derived from the token for Ondo, different ratio for xStocks, null for bStocks (F2, F13).
  - `rwa/dynamic/ai`: prices with no last-trade time; 52 of 61 overnight xStocks alerts hadn't moved 0.1% by the open (F17).
- Unclear errors: `kline/ai?interval=15m&limit=300&startTime=…&endTime=…` → `code=000002 "illegal parameter"` for every token, no field named. `interval=1h&limit=200` with no window worked in the same session. What works: `limit=200`, `endTime` only, page backwards (F14).
- Latency: not measured per endpoint; leave blank or say so.
- Rate limits: No (never hit at ~130 calls/min).
- Auth/signing: nothing went wrong; no auth. Only oddity: the two required headers (F3).
- Untrusted data: F2/F13 (`stockInfo.price`), F17 (stale `tokenPrice`), F4 (`sharesMultiplier` vs list `multiplier` vs on-chain `uiMultiplier`, undocumented relation), F15 (`uiMultiplier()` reverts on Ondo and xStocks; only bStocks implement BEP-677).

## 5. AI stack feedback

- Used: Wallet Skills (docs and command format). Not the CLI, not Agent Studio. Rating: you.
- Worked well: corporate-action reason codes (`cash_dividend`, `stock_split`, …) in the asset status API, exactly what a guard needs (F5); the documented command format once found.
- Did not work: flags only in a nested reference file an agent can't list (F6); `--fromTokenQty` sizes in token units, so a tokenized-stock quote needs the multiplier first (F7).
- Missing: `--fromUsd` sizing; a quote-at-size endpoint (pool depth) so a monitor can check fills without the CLI; a staleness guard on prices (F17).
- Agent Studio: N/A.

## 6. Tokenized-stock specifics

- Platforms: bStocks, Ondo, xStock (data for all three; no trades executed).
- Liquidity depth: no pool-depth data was available, so not observed directly. Activity proxy from k-lines, median 15-minute candles per weekend: Ondo 288, bStocks 219, xStocks 0. 60 of 679 BSC tokens also have a liquid Hyperliquid perp.
- Slippage: no trades; modelled 0.55% round trip (0.25% fee + 0.3% slippage). No figures.
- Outside hours: Friday close → Monday open, 8 weekends, 10 tickers: the naive "nothing moved" forecast missed the open by 99 bps on average; a forecast from Hyperliquid's 24/7 stock perps missed by 29.6 bps; tokens alone 31.4 bps. Live: 48 vs 83 bps (Wed→Thu), 62 vs 119 (Thu→Fri). Ondo stops trading Fri 8pm to Sun 8pm ET (F12). xStocks quotes sat unchanged for hours on the first live night (F17). Weekend of Oct 10–11 with the stale filter on: one alert, otherwise quiet.
- On-chain vs reference price: the reference isn't independent (F2/F13), so spreads were measured against the perp instead. Per-token basis while the exchange is open: Ondo median −0.00% (−0.13% to +0.01%); bStocks median −0.07% (−2.88% to +0.21%), AMD's bStocks token sat ~2.9% under the stock every day; xStocks too few session candles to learn.
- Issuer differences that forced special cases: `type` codes and suffixes (on/x/B); BEP-677 only on bStocks; `closeTime` convention; Ondo 24/5 window; `stockInfo.price` behaviour; xStocks stale quotes.

## 7. Redesign and requests

- First five minutes: one API reference generated from the live schema, with example responses for regular, overnight, closed, paused and corporate-action cases; a documented `type` enum and an `issuer` field on every token row; one complete quote and one swap example in the skill's SKILL.md.
- Endpoints/features wanted, one per line with what you'd build:
  1. Underlying's last official close with timestamp (independent reference price).
  2. Forward corporate-action calendar per token (ex-date, amount, expected multiplier change).
  3. Each issuer's trading window in asset status.
  4. Quote at size / pool depth through the API.
  5. Last-trade or price-updated time and 24h trade count on every dynamic price.
  6. Historical multipliers per token.
  7. Streaming (websocket) dynamic prices.
- One change that would have saved the most time: your pick. Candidates: the `type` enum / issuer field (F1, F10), or naming the field in `illegal parameter` (F14), or one `closeTime` convention (F16).
- Keep building: you.
