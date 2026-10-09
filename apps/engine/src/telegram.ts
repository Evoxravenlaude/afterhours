import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { FairValue } from "@afterhours/core";
import type { Store, AlertRow } from "./store.js";
import type { Notifier } from "./engine.js";
import { cardPng } from "./card.js";
import { score, issuerLabel, isOpen, lastClose, nextOpen } from "@afterhours/core";

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const usd = (x: number) => `$${x.toFixed(2)}`;

export function alertText(a: AlertRow, fv: FairValue): string {
  const dir = a.side === "buy" ? "under" : "over";
  const parts = [
    fv.inputs.external ? `perp ${usd(fv.inputs.external)}` : null,
    fv.inputs.tokenConsensus ? `issuers ${usd(fv.inputs.tokenConsensus)}` : null,
    `closed ${fv.inputs.hoursClosed.toFixed(0)}h`,
  ].filter(Boolean);
  return [
    `${a.ticker} on ${issuerLabel(a.issuer)} is ${pct(Math.abs(a.edgePct))} ${dir} fair value`,
    `Token: ${usd(a.sharePrice)}/share · Fair value ${usd(fv.value)} (band ${usd(fv.low)}–${usd(fv.high)})`,
    `Signals: ${parts.join(" · ")}`,
    `Edge after est. costs: ${pct(a.netEdgePct)}`,
    `Token: ${a.symbol} ${a.contract}`,
  ].join("\n");
}

export const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";

/**
 * The Agentic Wallet quote command (preview only, nothing is signed), per the skill's market-order reference:
 * baw market-order quote --fromTokenQty <qty> --fromToken <addr> --toToken <addr> --binanceChainId 56 --json
 * Quantities are in the from-token, so a sell sizes by the share price (approximate by the multiplier).
 */
export function quoteCommand(a: AlertRow, amountUsd = 100): string {
  const [from, to, qty] = a.side === "buy"
    ? [BSC_USDT, a.contract, String(amountUsd)]
    : [a.contract, BSC_USDT, (amountUsd / a.sharePrice).toFixed(4)];
  return `baw market-order quote --fromTokenQty ${qty} --fromToken ${from} --toToken ${to} --binanceChainId 56 --json`;
}

const ago = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)}s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)}h`);

/** Plain answer to "is it running?": last update, market state, coverage, and tonight's alerts. */
export function healthText(store: Store, now: number): string {
  const t = JSON.parse(store.get("lasttick") ?? "null") as { at: number; fv: number; alerts: number; silenced: number } | null;
  const open = isOpen(now);
  const lines = [
    t ? `Running. Last update ${ago(now - t.at)} ago${now - t.at > 5 * 60_000 ? " (late: check the deploy logs)" : ""}.` : "Started, no update yet.",
    open ? `Market open. Learning each token's normal gap to its stock; alerts start at the close.` : `Market closed. Opens in ${ago(nextOpen(now) - now)}.`,
    `Tokens with a learned gap: ${store.countPrefix("basis:")}.`,
  ];
  if (t && !open) lines.push(`Pricing ${t.fv} stocks; ${t.silenced} token(s) held back this minute.`);
  if (!open) {
    const tonight = store.alertsForPeriod(lastClose(now));
    lines.push(`Since the close: ${tonight.filter((a) => !a.suppressed).length} alerts sent, ${tonight.filter((a) => a.suppressed).length} silenced.`);
  }
  return lines.join("\n");
}

export class TelegramNotifier implements Notifier {
  bot: Bot;
  constructor(token: string, private store: Store, private publicUrl: string) {
    this.bot = new Bot(token);
    this.bot.command("start", async (ctx) => {
      store.subscribe(String(ctx.chat.id));
      await ctx.reply("You're in. When a tokenized stock on BNB Chain drifts from fair value while Wall Street is closed, you'll hear about it here, with a quote ready. Each morning after the open you get a card showing what the night was worth.\n\n/now: current fair values\n/score: forecast accuracy\n/health: is it running\n/mute and /unmute");
    });
    this.bot.command("mute", async (ctx) => { store.setMuted(String(ctx.chat.id), true); await ctx.reply("Muted. /unmute to resume."); });
    this.bot.command("unmute", async (ctx) => { store.setMuted(String(ctx.chat.id), false); await ctx.reply("Alerts back on."); });
    this.bot.command("now", async (ctx) => {
      const fvs = store.latestFairValues();
      await ctx.reply(fvs.length ? fvs.map((f) => `${f.ticker}: ${usd(f.value)} (${usd(f.low)}–${usd(f.high)})`).join("\n") : "Market's open. Fair values run while it's closed.");
    });
    this.bot.command("health", async (ctx) => { await ctx.reply(healthText(store, Date.now())); });
    this.bot.command("score", async (ctx) => {
      const s = score(store.forecasts());
      await ctx.reply(s.n ? `Forecasts scored: ${s.n}\nOur error at the open: ${s.maeBps.toFixed(1)} bps\nFriday-close guess: ${s.naiveMaeBps.toFixed(1)} bps\nImprovement: ${s.improvementPct.toFixed(0)}%\nFull scorecard: ${publicUrl}` : `No opens scored yet. Scorecard: ${publicUrl}`);
    });
    this.bot.callbackQuery(/^quote:(\d+)$/, async (ctx) => {
      const a = store.recentAlerts(500).find((x) => x.id === Number(ctx.match[1]));
      await ctx.answerCallbackQuery();
      if (a) await ctx.reply(`Preview in Binance Agentic Wallet (nothing is signed until you confirm):\n\n${quoteCommand(a)}\n\nCheck the contract: ${a.contract}`);
    });
    this.bot.callbackQuery(/^took:(\d+)$/, async (ctx) => {
      store.markTaken(Number(ctx.match[1]));
      await ctx.answerCallbackQuery({ text: "Logged. We'll score it at the open." });
    });
    this.bot.callbackQuery(/^skip:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery({ text: "Skipped." }); });
  }

  start() { this.bot.start({ drop_pending_updates: true }).catch(() => {}); }

  async alert(a: AlertRow, fv: FairValue) {
    const kb = new InlineKeyboard().text("Quote", `quote:${a.id}`).text("I took it", `took:${a.id}`).text("Skip", `skip:${a.id}`);
    for (const s of this.store.subscribers().filter((s) => !s.muted)) {
      await this.bot.api.sendMessage(s.chat_id, alertText(a, fv), { reply_markup: kb }).catch(() => {});
    }
  }

  async morning(periodStart: number) {
    const alerts = this.store.alertsForPeriod(periodStart);
    const png = cardPng({ periodLabel: new Date(periodStart).toUTCString().slice(0, 16) + " close → open", alerts, score: score(this.store.forecasts()) });
    for (const s of this.store.subscribers().filter((s) => !s.muted)) {
      this.store.bumpStreak(s.chat_id, Date.now());
      await this.bot.api.sendPhoto(s.chat_id, new InputFile(png, "afterhours.png"), { caption: `Last night, scored at the open. ${this.publicUrl}` }).catch(() => {});
    }
  }
}
