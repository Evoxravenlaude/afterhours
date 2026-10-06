import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { score, isOpen, nextOpen, lastClose } from "@afterhours/core";
import type { Store } from "./store.js";
import { cardPng, cardSvg } from "./card.js";

const here = dirname(fileURLToPath(import.meta.url));
const page = () => readFileSync(join(here, "../public/index.html"), "utf8");

export function app(store: Store, meta: { mode: string }) {
  const a = new Hono();
  a.get("/", (c) => c.html(page()));
  a.get("/api/status", (c) => {
    const now = Date.now();
    return c.json({ now, open: isOpen(now), lastClose: lastClose(now), nextOpen: nextOpen(now), mode: meta.mode });
  });
  a.get("/api/fair-values", (c) => c.json(store.latestFairValues()));
  a.get("/api/alerts", (c) => c.json(store.recentAlerts(Number(c.req.query("limit") ?? 100))));
  a.get("/api/forecasts", (c) => c.json(store.forecasts()));
  a.get("/api/score", (c) => c.json(score(store.forecasts())));
  a.get("/card/:period.png", (c) => {
    const p = Number(c.req.param("period"));
    const png = cardPng({ periodLabel: new Date(p).toUTCString().slice(0, 16) + " close → open", alerts: store.alertsForPeriod(p), score: score(store.forecasts()) });
    return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=300" } });
  });
  a.get("/card/:period.svg", (c) => {
    const p = Number(c.req.param("period"));
    return c.body(cardSvg({ periodLabel: new Date(p).toUTCString().slice(0, 16) + " close → open", alerts: store.alertsForPeriod(p), score: score(store.forecasts()) }), 200, { "content-type": "image/svg+xml" });
  });
  a.get("/health", (c) => c.text("ok"));
  return a;
}
