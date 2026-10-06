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
