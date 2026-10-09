import {
  fairValue, findDislocations, applyGuards, isOpen, lastClose, nextOpen, hoursClosed, score, shouldRealert, estimateBasis, sharePrice,
  type Dislocation, type FairValue,
} from "@afterhours/core";
import type { Store, AlertRow } from "./store.js";
import type { Snapshot } from "./collector.js";
import type { Config } from "./config.js";

export interface Notifier {
  alert(row: AlertRow, fv: FairValue): Promise<void>;
  morning(periodStart: number): Promise<void>;
}

export interface TickResult { fairValues: FairValue[]; alerts: AlertRow[]; suppressed: number; settled: string[] }

/**
 * One pass of the loop. Pure with respect to the outside world except through Store and Notifier,
 * so it can be driven by live snapshots or by tests.
 */
/** How long a token must sit back inside the band before a new alert episode can start. */
export const INBAND_DWELL_MS = 30 * 60_000;
/**
 * A token whose quoted price hasn't changed for this long is not trading, and its "dislocation" is just a stale
 * price. First live night (Oct 8–9): all 61 alerts were xStocks, 52 of them had moved less than 0.1% by the open,
 * and they lost 0.27% on average after costs, while scoring +1.0% against the stock's opening print.
 */
export const STALE_PRICE_MS = 3 * 3_600_000;
/** How long after the open we wait for an alerted token to trade before valuing it at its unchanged price. */
export const TRADED_WINDOW_MS = 6 * 3_600_000;

export class Engine {
  constructor(private store: Store, private cfg: Config, private notify?: Notifier) {}

  async tick(snap: Snapshot): Promise<TickResult> {
    const { now } = snap;
    const open = isOpen(now);
    const lcAt = lastClose(now);
    const noAt = nextOpen(now);
    const res: TickResult = { fairValues: [], alerts: [], suppressed: 0, settled: [] };

    for (const [ticker, s] of snap.tickers) {
      for (const q of s.quotes) this.trackPrice(q.contract, q.tokenPrice, now);
      // While the exchange is open: keep the latest spot so the close is captured when it shuts,
      // and learn each token's basis (its normal ratio to the real price) from paired observations.
      if (open) {
        if (s.oraclePx) {
          this.store.set(`spot:${ticker}`, String(s.oraclePx));
          for (const q of s.quotes) this.learnBasis(q.contract, sharePrice({ ...q, basis: undefined }) / s.oraclePx);
        }
        continue;
      }
      for (const q of s.quotes) { const b = Number(this.store.get(`basis:${q.contract}`)); if (b > 0) q.basis = b; }
      const closeKey = `close:${ticker}:${lcAt}`;
      let close = Number(this.store.get(closeKey));
      if (!close) {
        const spot = Number(this.store.get(`spot:${ticker}`));
        close = spot || s.stockPrice || 0;
        if (close) this.store.set(closeKey, String(close));
      }
      if (!close || !s.quotes.length) continue;

      const fv = fairValue({ ticker, now, lastClose: close, lastCloseAt: lcAt, hoursClosed: hoursClosed(now), quotes: s.quotes, external: s.external }, this.cfg.model);
      const tokenOnly = fairValue({ ticker, now, lastClose: close, lastCloseAt: lcAt, hoursClosed: hoursClosed(now), quotes: s.quotes }, this.cfg.model);
      this.store.saveFairValue(fv);
      res.fairValues.push(fv);

      // Lock the forecast in the minutes before the open.
      if (noAt - now <= this.cfg.forecastLeadMin * 60_000) {
        this.store.upsertForecast({ ticker, periodStart: lcAt, openAt: noAt, lastClose: close, fairValue: fv.value, tokenOnly: tokenOnly.value, external: s.external?.price });
      }

      const found = findDislocations(fv, s.quotes, this.cfg.costs);
      // An episode ends only when the token is back inside the band and stays there for 30 minutes.
      // Dipping just under the alert threshold doesn't count: on 2026-10-09 NVDAx hovered at 0.5% net edge
      // and alerted twice in ten minutes.
      for (const q of s.quotes) {
        const p = sharePrice(q);
        const sinceKey = `inbandSince:${q.contract}`;
        if (p >= fv.low && p <= fv.high) {
          const since = Number(this.store.get(sinceKey)) || now;
          if (!Number(this.store.get(sinceKey))) this.store.set(sinceKey, String(now));
          if (now - since >= INBAND_DWELL_MS) this.store.set(`inband:${q.contract}`, String(now));
        } else if (this.store.get(sinceKey)) this.store.set(sinceKey, "");
      }
      // A token whose normal gap to the stock hasn't been learned yet (it needs a few minutes of open-market
      // quotes) can't be judged: AMD's bStocks token sits ~2.9% under the stock every day. Stay quiet until learned.
      const learned = found.filter((d) => s.quotes.find((q) => q.contract === d.contract)?.basis !== undefined);
      res.suppressed += found.length - learned.length;
      const judged = learned.filter((d) => now - this.priceChangedAt(d.contract) <= STALE_PRICE_MS);
      const stale = learned.filter((d) => !judged.includes(d)).map((d) => ({ ...d, reason: "price not updating for 3h+" }));
      const guarded = applyGuards(judged, s.guards, now);
      const alerts = guarded.alerts, suppressed = [...guarded.suppressed, ...stale];
      // One silenced record per token and reason per night, not one per minute.
      for (const d of suppressed) { res.suppressed++; if (!this.store.hasSuppressed(d.contract, lcAt, d.reason)) this.store.insertAlert(d, lcAt, d.reason); }
      for (const d of alerts) {
        if (!this.shouldAlert(d, now)) continue;
        const id = this.store.insertAlert(d, lcAt);
        const row = { ...d, id, periodStart: lcAt } as AlertRow;
        res.alerts.push(row);
        await this.notify?.alert(row, fv).catch(() => {});
      }
    }

    // After the open: read the opening print and settle forecasts and alerts for that period.
    if (open) { res.settled = await this.settle(snap); await this.settleTraded(snap); }
    return res;
  }

  /** Rolling window of the last 60 open-market ratios per token; the basis is their median. */
  private learnBasis(contract: string, ratio: number) {
    if (!Number.isFinite(ratio)) return;
    const key = `bratios:${contract}`;
    const xs: number[] = JSON.parse(this.store.get(key) ?? "[]");
    xs.push(ratio); while (xs.length > 60) xs.shift();
    this.store.set(key, JSON.stringify(xs));
    const b = estimateBasis(xs.map((r) => ({ tokenShare: r, truth: 1 })));
    if (b) this.store.set(`basis:${contract}`, String(b));
  }

  /** Remember when each token's quoted price last changed; a new token counts as unchanged until it moves. */
  private trackPrice(contract: string, price: number, now: number) {
    const prev = this.store.get(`px:${contract}`);
    if (prev === undefined) { this.store.set(`px:${contract}`, String(price)); this.store.set(`pxat:${contract}`, "0"); return; }
    if (Number(prev) !== price) { this.store.set(`px:${contract}`, String(price)); this.store.set(`pxat:${contract}`, String(now)); }
  }
  private priceChangedAt(contract: string): number { return Number(this.store.get(`pxat:${contract}`)) || 0; }

  private shouldAlert(d: Dislocation, now: number): boolean {
    return shouldRealert(this.store.lastAlertFor(d.contract, d.side), { at: now, netEdgePct: d.netEdgePct }, Number(this.store.get(`inband:${d.contract}`) ?? 0));
  }

  private async settle(snap: Snapshot): Promise<string[]> {
    const settled: string[] = [];
    const due = this.store.unsettledForecasts(snap.now - this.cfg.openReadDelayMin * 60_000);
    const periods = new Set<number>();
    for (const f of due) {
      const s = snap.tickers.get(f.ticker);
      if (!s?.oraclePx) continue;
      this.store.settleForecast(f.ticker, f.openAt, s.oraclePx);
      for (const a of this.store.alertsForPeriod(f.periodStart).filter((a) => a.ticker === f.ticker && !a.suppressed && a.worthPct == null)) {
        const worth = a.side === "buy" ? s.oraclePx / a.sharePrice - 1 : a.sharePrice / s.oraclePx - 1;
        this.store.settleAlert(a.id, s.oraclePx, worth);   // the token side is valued once the token trades (settleTraded)
      }
      settled.push(f.ticker);
      periods.add(f.periodStart);
    }
    // A quiet night has nothing to wait for: send its card now. Nights with alerts send once they're valued.
    for (const p of periods) {
      if (this.store.get(`card:${p}`) || this.store.alertsForPeriod(p).some((a) => !a.suppressed)) continue;
      this.store.set(`card:${p}`, "1"); await this.notify?.morning(p).catch(() => {});
    }
    return settled;
  }

  /**
   * What each alert actually paid: the same token's per-share price at its first change after the open (it traded),
   * or its price 6 hours after the open if it never moved. Matches the backtest's exit rule. The morning card goes
   * out once every alert of the night is valued.
   */
  private async settleTraded(snap: Snapshot) {
    const quotes = new Map([...snap.tickers.values()].flatMap((s) => s.quotes.map((q) => [q.contract, q] as const)));
    const touched = new Set<number>();
    for (const a of this.store.awaitingTraded()) {
      const openAt = nextOpen(a.periodStart), q = quotes.get(a.contract);
      const moved = this.priceChangedAt(a.contract) > openAt, late = snap.now >= openAt + TRADED_WINDOW_MS;
      if (late) touched.add(a.periodStart);
      if (!q) continue;
      if (!moved && !late) continue;
      const b = Number(this.store.get(`basis:${a.contract}`)) || 1;
      const p = q.tokenPrice / q.multiplier / b;
      this.store.setTraded(a.id, a.side === "buy" ? p / a.sharePrice - 1 : a.sharePrice / p - 1);
      touched.add(a.periodStart);
    }
    for (const p of touched) {
      const pending = this.store.alertsForPeriod(p).some((a) => !a.suppressed && a.tradedPct == null);
      if ((!pending || snap.now >= nextOpen(p) + TRADED_WINDOW_MS) && !this.store.get(`card:${p}`)) { this.store.set(`card:${p}`, "1"); await this.notify?.morning(p).catch(() => {}); }
    }
  }

  scorecard() { return score(this.store.forecasts()); }
}
