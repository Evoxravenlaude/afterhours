import { Resvg } from "@resvg/resvg-js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FONTS = ["400Regular/Inter_400Regular.ttf", "700Bold/Inter_700Bold.ttf", "800ExtraBold/Inter_800ExtraBold.ttf"]
  .map((f) => { try { return require.resolve(`@expo-google-fonts/inter/${f}`); } catch { return null; } })
  .filter((x): x is string => !!x);
import type { AlertRow } from "./store.js";
import { issuerLabel, type Score } from "@afterhours/core";

export interface CardData {
  periodLabel: string;         // "Fri close → Mon open"
  alerts: AlertRow[];
  score: Score;
  streak?: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const pct = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;

/** The morning card: what happened while the market slept, and whether we were right. */
export function cardSvg(d: CardData): string {
  const live = d.alerts.filter((a) => !a.suppressed);
  // Valued by the token's own price after the open, not by the stock's opening print.
  const settled = live.filter((a) => a.tradedPct != null);
  const taken = live.filter((a) => a.taken);
  const best = settled.sort((a, b) => (b.tradedPct ?? 0) - (a.tradedPct ?? 0))[0];
  const silenced = d.alerts.filter((a) => a.suppressed).length;
  const err = d.score.n ? `${d.score.maeBps.toFixed(0)} bps vs ${d.score.naiveMaeBps.toFixed(0)} naive` : "first week, scoring starts Monday";

  const rows: [string, string][] = [
    ["Alerts while closed", String(live.length)],
    ["You acted on", String(taken.length)],
    ["Best alert, traded", best ? `${esc(best.ticker)} ${esc(issuerLabel(best.issuer))} ${pct(best.tradedPct!)}` : "—"],
    ["Silenced (dividends, splits, pauses)", String(silenced)],
    ["Forecast error at the open", err],
  ];
  // resvg ignores the CSS `font` shorthand, so every text element carries explicit attributes.
  const T = (x: number, y: number, size: number, weight: number, fill: string, body: string, anchor = "start") =>
    `<text x="${x}" y="${y}" font-family="Inter" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${body}</text>`;
  const lines = rows.map(([k, v], i) => {
    const y = 470 + i * 92;
    return `<line x1="80" x2="1000" y1="${y - 58}" y2="${y - 58}" stroke="#2a2420" stroke-width="2"/>` +
      T(80, y, 32, 400, "#cfc8bb", esc(k)) + T(1000, y, 34, 700, "#f4efe6", v, "end");
  }).join("");
  const headline = live.length ? (best ? pct(best.tradedPct!) : `${live.length} alerts`) : "Quiet night";
  const sub = live.length ? (best ? "best alert, token price after the open" : "waiting for the open") : "nothing worth waking you for";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="#14110f"/>
  <circle cx="930" cy="150" r="70" fill="#e8b04b" opacity="0.92"/><circle cx="962" cy="126" r="62" fill="#14110f"/>
  ${T(80, 150, 60, 700, "#f4efe6", "Afterhours")}
  ${T(80, 205, 30, 400, "#a49e93", esc(d.periodLabel))}
  ${T(72, 345, 150, 800, "#e8b04b", headline)}
  ${T(80, 395, 30, 400, "#a49e93", sub)}
  ${lines}
  ${T(80, 1010, 24, 400, "#7d776d", `${d.streak ? `${d.streak}-day streak · ` : ""}fair value from Hyperliquid stock perps + bStocks, Ondo, xStocks · not advice`)}
</svg>`;
}

export function cardPng(d: CardData): Buffer {
  // Bundled Inter keeps rendering fast and identical on every host; system fonts are only a fallback.
  return new Resvg(cardSvg(d), { fitTo: { mode: "width", value: 1080 }, font: { fontFiles: FONTS, loadSystemFonts: FONTS.length === 0, defaultFontFamily: "Inter" } }).render().asPng();
}
