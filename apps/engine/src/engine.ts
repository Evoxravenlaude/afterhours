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
export class Engine {
  constructor(private store: Store, private cfg: Config, private notify?: Notifier) {}

  async tick(snap: Snapshot): Promise<TickResult> {
    const { now } = snap;
    const open = isOpen(now);
    const lcAt = lastClose(now);
    const noAt = nextOpen(now);
    const res: TickResult = { fairValues: [], alerts: [], suppressed: 0, settled: [] };

    for (const [ticker, s] of snap.tickers) {
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
      for (const q of s.quotes) if (!found.some((d) => d.contract === q.contract)) this.store.set(`inband:${q.contract}`, String(now));
      // A token whose normal gap to the stock hasn't been learned yet (it needs a few minutes of open-market
      // quotes) can't be judged: AMD's bStocks token sits ~2.9% under the stock every day. Stay quiet until learned.
      const judged = found.filter((d) => s.quotes.find((q) => q.contract === d.contract)?.basis !== undefined);
      res.suppressed += found.length - judged.length;
      const { alerts, suppressed } = applyGuards(judged, s.guards, now);
      for (const d of suppressed) { this.store.insertAlert(d, lcAt, d.reason); res.suppressed++; }
      for (const d of alerts) {
        if (!this.shouldAlert(d, now)) continue;
        const id = this.store.insertAlert(d, lcAt);
        const row = { ...d, id, periodStart: lcAt } as AlertRow;
        res.alerts.push(row);
        await this.notify?.alert(row, fv).catch(() => {});
      }
    }

    // After the open: read the opening print and settle forecasts and alerts for that period.
    if (open) res.settled = await this.settle(snap);
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
        // What the alert actually paid: the same token's per-share price now, on the same basis it was alerted on.
        const q = s.quotes.find((x) => x.contract === a.contract);
        const b = Number(this.store.get(`basis:${a.contract}`)) || 1;
        const now = q ? q.tokenPrice / q.multiplier / b : undefined;
        const traded = now === undefined ? undefined : a.side === "buy" ? now / a.sharePrice - 1 : a.sharePrice / now - 1;
        this.store.settleAlert(a.id, s.oraclePx, worth, traded);
      }
      periods.add(f.periodStart);
      settled.push(f.ticker);
    }
    for (const p of periods) await this.notify?.morning(p).catch(() => {});
    return settled;
  }

  scorecard() { return score(this.store.forecasts()); }
}
