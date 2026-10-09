import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { Store } from "./store.js";
import { Engine } from "./engine.js";
import { LiveCollector } from "./collector.js";
import { TelegramNotifier } from "./telegram.js";
import { app } from "./server.js";
import { seedFromBacktest } from "./replay.js";

const store = new Store(config.dbPath);
const tg = config.telegramToken ? new TelegramNotifier(config.telegramToken, store, config.publicUrl) : undefined;
const engine = new Engine(store, config, tg);

serve({ fetch: app(store, { mode: config.mode }).fetch, port: config.port });
console.log(`afterhours ${config.mode} on :${config.port}${tg ? " with Telegram" : ""}`);
tg?.start();

if (config.mode === "replay") {
  const r = seedFromBacktest(store, config.replayPath);
  console.log(`replay: loaded ${r.forecasts} forecasts and ${r.alerts} alerts from ${config.replayPath}`);
} else {
  const collector = new LiveCollector();
  let running = false;
  const loop = async () => {
    if (running) return; running = true;
    try {
      const r = await engine.tick(await collector.snapshot());
      store.set("lasttick", JSON.stringify({ at: Date.now(), fv: r.fairValues.length, alerts: r.alerts.length, silenced: r.suppressed }));
      console.log(`${new Date().toISOString()} fv=${r.fairValues.length} alerts=${r.alerts.length} silenced=${r.suppressed}${r.settled.length ? ` settled=${r.settled.join(",")}` : ""}`);
    } catch (e) { console.error("tick failed:", e); }
    finally { running = false; }
  };
  loop(); setInterval(loop, config.tickMs);
}
