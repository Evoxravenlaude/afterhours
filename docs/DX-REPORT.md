# Developer Experience Report: Binance Web3 API, Tokenized Securities, Agentic Wallet

Written as we built Afterhours for BNB Hack: Tokenized Stocks Edition. Every entry is dated and records what we tried, what happened, and what we'd change. Nothing here was written after the fact.

## Summary of findings

_Filled in on submission day from the log below._

## Friction log

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

**F12. K-lines omit intervals with no trades.**
EEMon's 1h k-lines jump from Saturday 05:00 UTC to Monday 00:00 UTC. That is reasonable, but undocumented: an integrator who assumes one candle per interval will misalign series or treat a quiet token as fresh. We now separate "fresh" quotes (which shape fair value) from "held" last-traded prices (which can still be flagged).
_Suggestion:_ state the gap behaviour, or add a `fill=previous` option.

**F13. `stockInfo.price` is null for bStocks.**
MUB returned `"price": null` in `stockInfo` while xStocks and Ondo returned numbers. Three issuers, three behaviours for the same field.
