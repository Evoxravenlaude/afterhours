import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Dislocation, FairValue, Forecast } from "@afterhours/core";

export interface AlertRow extends Dislocation { id: number; periodStart: number; suppressed?: string | null; taken?: number; openPrice?: number | null; worthPct?: number | null; tradedPct?: number | null }

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS fair_values (ticker TEXT, at INTEGER, json TEXT, PRIMARY KEY (ticker, at));
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT, issuer TEXT, symbol TEXT, contract TEXT,
        side TEXT, share_price REAL, fair_value REAL, edge_pct REAL, net_edge_pct REAL, at INTEGER,
        period_start INTEGER, suppressed TEXT, taken INTEGER DEFAULT 0, open_price REAL, worth_pct REAL);
      CREATE TABLE IF NOT EXISTS forecasts (
        ticker TEXT, period_start INTEGER, open_at INTEGER, last_close REAL, fair_value REAL, token_only REAL,
        external REAL, actual_open REAL, PRIMARY KEY (ticker, open_at));
      CREATE TABLE IF NOT EXISTS subscribers (chat_id TEXT PRIMARY KEY, muted INTEGER DEFAULT 0, streak INTEGER DEFAULT 0, last_card INTEGER);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
    `);
    // traded_pct: the alert valued by the same token's price after the open (what a holder could realise).
    try { this.db.exec("ALTER TABLE alerts ADD COLUMN traded_pct REAL"); } catch { /* already there */ }
  }

  saveFairValue(fv: FairValue) {
    this.db.prepare("INSERT OR REPLACE INTO fair_values VALUES (?,?,?)").run(fv.ticker, fv.at, JSON.stringify(fv));
  }
  latestFairValues(): FairValue[] {
    return (this.db.prepare(`SELECT json FROM fair_values f WHERE at = (SELECT MAX(at) FROM fair_values WHERE ticker = f.ticker) ORDER BY ticker`).all() as { json: string }[]).map((r) => JSON.parse(r.json));
  }

  lastAlertFor(contract: string, side: string): AlertRow | undefined {
    return this.row(this.db.prepare("SELECT * FROM alerts WHERE contract = ? AND side = ? AND suppressed IS NULL ORDER BY at DESC LIMIT 1").get(contract, side));
  }
  insertAlert(d: Dislocation, periodStart: number, suppressed?: string): number {
    const r = this.db.prepare(`INSERT INTO alerts (ticker, issuer, symbol, contract, side, share_price, fair_value, edge_pct, net_edge_pct, at, period_start, suppressed)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.ticker, d.issuer, d.symbol, d.contract, d.side, d.sharePrice, d.fairValue, d.edgePct, d.netEdgePct, d.at, periodStart, suppressed ?? null);
    return Number(r.lastInsertRowid);
  }
  awaitingTraded(): AlertRow[] {
    return (this.db.prepare("SELECT * FROM alerts WHERE suppressed IS NULL AND worth_pct IS NOT NULL AND traded_pct IS NULL ORDER BY at").all() as any[]).map((r) => this.row(r)!);
  }
  setTraded(id: number, tradedPct: number) { this.db.prepare("UPDATE alerts SET traded_pct = ? WHERE id = ?").run(tradedPct, id); }
  hasSuppressed(contract: string, periodStart: number, reason: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM alerts WHERE contract = ? AND period_start = ? AND suppressed = ? LIMIT 1").get(contract, periodStart, reason);
  }
  markTaken(id: number) { this.db.prepare("UPDATE alerts SET taken = 1 WHERE id = ?").run(id); }
  alertsForPeriod(periodStart: number): AlertRow[] {
    return (this.db.prepare("SELECT * FROM alerts WHERE period_start = ? ORDER BY at").all(periodStart) as any[]).map((r) => this.row(r)!);
  }
  recentAlerts(limit = 50): AlertRow[] {
    return (this.db.prepare("SELECT * FROM alerts ORDER BY at DESC LIMIT ?").all(limit) as any[]).map((r) => this.row(r)!);
  }
  settleAlert(id: number, openPrice: number, worthPct: number, tradedPct?: number) {
    this.db.prepare("UPDATE alerts SET open_price = ?, worth_pct = ?, traded_pct = ? WHERE id = ?").run(openPrice, worthPct, tradedPct ?? null, id);
  }
  private row(r: any): AlertRow | undefined {
    if (!r) return undefined;
    return { id: r.id, ticker: r.ticker, issuer: r.issuer, symbol: r.symbol, contract: r.contract, side: r.side, sharePrice: r.share_price, fairValue: r.fair_value,
      edgePct: r.edge_pct, netEdgePct: r.net_edge_pct, at: r.at, periodStart: r.period_start, suppressed: r.suppressed, taken: r.taken, openPrice: r.open_price, worthPct: r.worth_pct, tradedPct: r.traded_pct };
  }

  upsertForecast(f: Forecast & { external?: number }) {
    this.db.prepare(`INSERT INTO forecasts (ticker, period_start, open_at, last_close, fair_value, token_only, external, actual_open) VALUES (?,?,?,?,?,?,?,NULL)
      ON CONFLICT(ticker, open_at) DO UPDATE SET fair_value = excluded.fair_value, token_only = excluded.token_only, external = excluded.external`)
      .run(f.ticker, f.periodStart, f.openAt, f.lastClose, f.fairValue, f.tokenOnly ?? null, f.external ?? null);
  }
  settleForecast(ticker: string, openAt: number, actualOpen: number) {
    this.db.prepare("UPDATE forecasts SET actual_open = ? WHERE ticker = ? AND open_at = ?").run(actualOpen, ticker, openAt);
  }
  forecasts(): (Forecast & { external?: number })[] {
    return (this.db.prepare("SELECT * FROM forecasts ORDER BY open_at DESC").all() as any[]).map((r) => ({
      ticker: r.ticker, periodStart: r.period_start, openAt: r.open_at, lastClose: r.last_close, fairValue: r.fair_value,
      tokenOnly: r.token_only ?? undefined, external: r.external ?? undefined, actualOpen: r.actual_open ?? undefined,
    }));
  }
  unsettledForecasts(before: number) {
    return this.forecasts().filter((f) => !f.actualOpen && f.openAt <= before);
  }

  subscribe(chatId: string) { this.db.prepare("INSERT OR IGNORE INTO subscribers (chat_id) VALUES (?)").run(chatId); }
  setMuted(chatId: string, muted: boolean) { this.db.prepare("UPDATE subscribers SET muted = ? WHERE chat_id = ?").run(muted ? 1 : 0, chatId); }
  subscribers(): { chat_id: string; muted: number; streak: number; last_card: number | null }[] {
    return this.db.prepare("SELECT * FROM subscribers").all() as any;
  }
  bumpStreak(chatId: string, at: number) { this.db.prepare("UPDATE subscribers SET streak = streak + 1, last_card = ? WHERE chat_id = ?").run(at, chatId); }

  get(k: string): string | undefined { return (this.db.prepare("SELECT v FROM kv WHERE k = ?").get(k) as any)?.v; }
  set(k: string, v: string) { this.db.prepare("INSERT OR REPLACE INTO kv VALUES (?,?)").run(k, v); }
  countPrefix(prefix: string): number { return Number((this.db.prepare("SELECT COUNT(*) AS n FROM kv WHERE k LIKE ? AND v <> ''").get(prefix + "%") as any)?.n ?? 0); }
}
